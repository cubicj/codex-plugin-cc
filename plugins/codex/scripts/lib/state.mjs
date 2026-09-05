import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveWorkspaceRoot } from "./workspace.mjs";

const STATE_VERSION = 1;
export const PLUGIN_DATA_ENV = "CODEX_COMPANION_PLUGIN_DATA";
const HOST_PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";
const FALLBACK_STATE_ROOT_DIR = path.join(os.tmpdir(), "codex-companion");
const STATE_FILE_NAME = "state.json";
const JOBS_DIR_NAME = "jobs";
const MAX_JOBS = 50;
const STATE_LOCK_WAIT_MS = 5000;
const STATE_LOCK_STALE_MS = 30000;
const STATE_LOCK_RETRY_MS = 10;
const STATE_LOCK_RECLAIM_STALE_MS = 2000;
const stateLockWaitBuffer = new Int32Array(new SharedArrayBuffer(4));

function nowIso() {
  return new Date().toISOString();
}

function defaultState() {
  return {
    version: STATE_VERSION,
    config: {
      stopReviewGate: false
    },
    jobs: []
  };
}

export function resolveStateDir(cwd) {
  const workspaceRoot = resolveWorkspaceRoot(cwd);
  let canonicalWorkspaceRoot = workspaceRoot;
  try {
    canonicalWorkspaceRoot = fs.realpathSync.native(workspaceRoot);
  } catch {
    canonicalWorkspaceRoot = workspaceRoot;
  }

  const slugSource = path.basename(workspaceRoot) || "workspace";
  const slug = slugSource.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "workspace";
  const hash = createHash("sha256").update(canonicalWorkspaceRoot).digest("hex").slice(0, 16);
  // CLAUDE_PLUGIN_DATA is scoped to this plugin while its hook runs, but the
  // SessionStart env file is shared by every plugin. Persist that scoped value
  // under a Codex-owned name so a sibling hook cannot redirect our later jobs.
  // Keep the host variable as a fallback for direct and pre-upgrade callers.
  const pluginDataDir = process.env[PLUGIN_DATA_ENV] || process.env[HOST_PLUGIN_DATA_ENV];
  const stateRoot = pluginDataDir ? path.join(pluginDataDir, "state") : FALLBACK_STATE_ROOT_DIR;
  return path.join(stateRoot, `${slug}-${hash}`);
}

export function resolveStateFile(cwd) {
  return path.join(resolveStateDir(cwd), STATE_FILE_NAME);
}

export function resolveJobsDir(cwd) {
  return path.join(resolveStateDir(cwd), JOBS_DIR_NAME);
}

export function ensureStateDir(cwd) {
  fs.mkdirSync(resolveJobsDir(cwd), { recursive: true });
}

export function loadState(cwd) {
  const stateFile = resolveStateFile(cwd);
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return {
      ...defaultState(),
      ...parsed,
      config: {
        ...defaultState().config,
        ...(parsed.config ?? {})
      },
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : []
    };
  } catch {
    return defaultState();
  }
}

function pruneJobs(jobs) {
  return [...jobs]
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")))
    .slice(0, MAX_JOBS);
}

function removeFileIfExists(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function isNewerJob(candidate, incumbent) {
  return String(candidate.updatedAt ?? "").localeCompare(String(incumbent.updatedAt ?? "")) > 0;
}

function reclaimStateLock(lockFile) {
  const reclaimFile = `${lockFile}.reclaim`;
  let reclaimFd;
  try {
    reclaimFd = fs.openSync(reclaimFile, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") {
      throw error;
    }
    try {
      if (Date.now() - fs.statSync(reclaimFile).mtimeMs > STATE_LOCK_RECLAIM_STALE_MS) {
        fs.unlinkSync(reclaimFile);
      }
    } catch (guardError) {
      if (guardError.code !== "ENOENT") {
        throw guardError;
      }
    }
    return;
  }

  try {
    if (Date.now() - fs.statSync(lockFile).mtimeMs > STATE_LOCK_STALE_MS) {
      fs.unlinkSync(lockFile);
    }
  } finally {
    try {
      fs.unlinkSync(reclaimFile);
    } finally {
      fs.closeSync(reclaimFd);
    }
  }
}

function withStateLock(cwd, action) {
  ensureStateDir(cwd);
  const lockFile = `${resolveStateFile(cwd)}.lock`;
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;
  let lockFd;
  while (lockFd === undefined) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for state lock: ${lockFile}`);
    }
    try {
      lockFd = fs.openSync(lockFile, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const lock = fs.statSync(lockFile);
        if (Date.now() - lock.mtimeMs > STATE_LOCK_STALE_MS) {
          reclaimStateLock(lockFile);
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        continue;
      }
      Atomics.wait(stateLockWaitBuffer, 0, 0, STATE_LOCK_RETRY_MS);
    }
  }

  try {
    return action();
  } finally {
    try {
      const ownedLock = fs.fstatSync(lockFd);
      const currentLock = fs.statSync(lockFile);
      if (ownedLock.dev === currentLock.dev && ownedLock.ino === currentLock.ino) {
        fs.unlinkSync(lockFile);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    } finally {
      fs.closeSync(lockFd);
    }
  }
}

function saveStateLocked(cwd, state, options) {
  const previousJobs = loadState(cwd).jobs;
  ensureStateDir(cwd);

  // Merge with the current on-disk jobs so a stale snapshot never destroys
  // records written by a concurrent process. A job disappears only when the
  // caller removed it explicitly (removedJobIds) or the prune cap drops it.
  const removedJobIds = new Set(options.removedJobIds ?? []);
  const mergedById = new Map((state.jobs ?? []).map((job) => [job.id, job]));
  for (const job of previousJobs) {
    const snapshotJob = mergedById.get(job.id);
    if (!snapshotJob || isNewerJob(job, snapshotJob)) {
      mergedById.set(job.id, job);
    }
  }

  const droppedById = new Map();
  for (const jobId of removedJobIds) {
    const job = mergedById.get(jobId);
    if (job) {
      droppedById.set(jobId, job);
      mergedById.delete(jobId);
    }
  }

  const nextJobs = pruneJobs([...mergedById.values()]);
  const nextState = {
    version: STATE_VERSION,
    config: {
      ...defaultState().config,
      ...(state.config ?? {})
    },
    jobs: nextJobs
  };

  const retainedIds = new Set(nextJobs.map((job) => job.id));
  for (const job of mergedById.values()) {
    if (!retainedIds.has(job.id)) {
      droppedById.set(job.id, job);
    }
  }
  for (const job of droppedById.values()) {
    removeJobFile(resolveJobFile(cwd, job.id));
    removeFileIfExists(job.logFile);
  }

  const stateFile = resolveStateFile(cwd);
  const temporaryFile = `${stateFile}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify(nextState, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporaryFile, stateFile);
  } finally {
    removeFileIfExists(temporaryFile);
  }
  return nextState;
}

export function saveState(cwd, state, options = {}) {
  return withStateLock(cwd, () => saveStateLocked(cwd, state, options));
}

export function updateState(cwd, mutate, options = {}) {
  return withStateLock(cwd, () => {
    const state = loadState(cwd);
    mutate(state);
    return saveStateLocked(cwd, state, options);
  });
}

export function generateJobId(prefix = "job") {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function upsertJob(cwd, jobPatch) {
  return updateState(cwd, (state) => {
    const timestamp = nowIso();
    const existingIndex = state.jobs.findIndex((job) => job.id === jobPatch.id);
    if (existingIndex === -1) {
      state.jobs.unshift({
        createdAt: timestamp,
        updatedAt: timestamp,
        ...jobPatch
      });
      return;
    }
    state.jobs[existingIndex] = {
      ...state.jobs[existingIndex],
      ...jobPatch,
      updatedAt: timestamp
    };
  });
}

export function listJobs(cwd) {
  return loadState(cwd).jobs;
}

export function setConfig(cwd, key, value) {
  return updateState(cwd, (state) => {
    state.config = {
      ...state.config,
      [key]: value
    };
  });
}

export function getConfig(cwd) {
  return loadState(cwd).config;
}

export function writeJobFile(cwd, jobId, payload) {
  ensureStateDir(cwd);
  const jobFile = resolveJobFile(cwd, jobId);
  fs.writeFileSync(jobFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return jobFile;
}

export function readJobFile(jobFile) {
  return JSON.parse(fs.readFileSync(jobFile, "utf8"));
}

function removeJobFile(jobFile) {
  if (fs.existsSync(jobFile)) {
    fs.unlinkSync(jobFile);
  }
}

export function resolveJobLogFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.log`);
}

export function resolveJobFile(cwd, jobId) {
  ensureStateDir(cwd);
  return path.join(resolveJobsDir(cwd), `${jobId}.json`);
}
