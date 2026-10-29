#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";

import { terminateProcessTree } from "./lib/process.mjs";
import { BROKER_ENDPOINT_ENV } from "./lib/app-server.mjs";
import {
  clearBrokerSession,
  LOG_FILE_ENV,
  loadBrokerSession,
  PID_FILE_ENV,
  recordedBrokerPid,
  sendBrokerShutdown,
  teardownBrokerSession
} from "./lib/broker-lifecycle.mjs";
import {
  loadState,
  PLUGIN_DATA_ENV,
  readJobFile,
  resolveJobFile,
  resolveStateFile,
  updateState,
  writeJobFile
} from "./lib/state.mjs";
import { appendLogLine } from "./lib/tracked-jobs.mjs";
import { TRANSCRIPT_PATH_ENV } from "./lib/claude-session-transfer.mjs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";

export const SESSION_ID_ENV = "CODEX_COMPANION_SESSION_ID";
const HOST_PLUGIN_DATA_ENV = "CLAUDE_PLUGIN_DATA";

function readHookInput() {
  const raw = fs.readFileSync(0, "utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

function shellEscape(value) {
  return `'${String(value).replace(/'/g, `'\"'\"'`)}'`;
}

function appendEnvVar(name, value) {
  if (!process.env.CLAUDE_ENV_FILE || value == null || value === "") {
    return;
  }
  const line = `export ${name}=${shellEscape(value)}`;
  // Claude Code re-runs SessionStart on every resume/compact and reuses CLAUDE_ENV_FILE, so a
  // blind append accumulates duplicate `export` lines across restarts (#322). After enough
  // restarts every Bash-tool command is prefixed with N copies of these exports, which spams logs
  // and — on long Windows sessions — corrupts the inlined command so the Bash tool returns no
  // output. Stay append-only (the hooks run in parallel and the docs require append so sibling
  // SessionStart hooks don't clobber each other's CLAUDE_ENV_FILE writes), but skip only when the
  // current value is already the effective (last) export for this name. If a different value is
  // last (e.g. another session wrote after us), re-append so the current value wins; the same value
  // re-firing is a no-op, so it cannot accumulate.
  try {
    if (fs.existsSync(process.env.CLAUDE_ENV_FILE)) {
      const priorExports = fs
        .readFileSync(process.env.CLAUDE_ENV_FILE, "utf8")
        .split("\n")
        .filter((existingLine) => existingLine.startsWith(`export ${name}=`));
      if (priorExports.length > 0 && priorExports[priorExports.length - 1] === line) {
        return;
      }
    }
  } catch {}
  fs.appendFileSync(process.env.CLAUDE_ENV_FILE, `${line}\n`, "utf8");
}

function cleanupSessionJobs(cwd, sessionId) {
  if (!cwd || !sessionId) {
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(cwd);
  const stateFile = resolveStateFile(workspaceRoot);
  if (!fs.existsSync(stateFile)) {
    return;
  }

  updateState(workspaceRoot, (state) => {
    for (const job of state.jobs) {
      if (job.sessionId !== sessionId || (job.status !== "queued" && job.status !== "running")) {
        continue;
      }
      try {
        terminateProcessTree(job.pid ?? Number.NaN);
      } catch {
        // Ignore teardown failures during session shutdown.
      }

      const completedAt = new Date().toISOString();
      const errorMessage = "Cancelled because the Claude session ended.";
      Object.assign(job, {
        status: "cancelled",
        phase: "cancelled",
        pid: null,
        completedAt,
        errorMessage,
        updatedAt: completedAt
      });
      const jobFile = resolveJobFile(workspaceRoot, job.id);
      const existing = fs.existsSync(jobFile) ? readJobFile(jobFile) : {};
      writeJobFile(workspaceRoot, job.id, {
        ...existing,
        ...job,
        cancelledAt: completedAt
      });
      appendLogLine(job.logFile, errorMessage);
    }
  });
}

function handleSessionStart(input) {
  appendEnvVar(SESSION_ID_ENV, input.session_id);
  appendEnvVar(TRANSCRIPT_PATH_ENV, input.transcript_path);
  appendEnvVar(PLUGIN_DATA_ENV, process.env[HOST_PLUGIN_DATA_ENV]);
}

async function handleSessionEnd(input) {
  const cwd = input.cwd || process.cwd();
  const sessionId = input.session_id || process.env[SESSION_ID_ENV];
  cleanupSessionJobs(cwd, sessionId);

  const state = loadState(resolveWorkspaceRoot(cwd));
  const hasActiveJobs = state.jobs.some((job) => job.status === "queued" || job.status === "running");
  if (hasActiveJobs) {
    return;
  }

  const brokerSession =
    loadBrokerSession(cwd) ??
    (process.env[BROKER_ENDPOINT_ENV]
      ? {
          endpoint: process.env[BROKER_ENDPOINT_ENV],
          pidFile: process.env[PID_FILE_ENV] ?? null,
          logFile: process.env[LOG_FILE_ENV] ?? null
        }
      : null);
  const brokerEndpoint = brokerSession?.endpoint ?? null;
  const pidFile = brokerSession?.pidFile ?? null;
  const logFile = brokerSession?.logFile ?? null;
  const sessionDir = brokerSession?.sessionDir ?? null;

  if (brokerEndpoint) {
    await sendBrokerShutdown(brokerEndpoint);
  }

  const pid = recordedBrokerPid(brokerSession);

  teardownBrokerSession({
    endpoint: brokerEndpoint,
    pidFile,
    logFile,
    sessionDir,
    pid,
    killProcess: terminateProcessTree
  });
  clearBrokerSession(cwd);
}

async function main() {
  const input = readHookInput();
  const eventName = process.argv[2] ?? input.hook_event_name ?? "";

  if (eventName === "SessionStart") {
    handleSessionStart(input);
    return;
  }

  if (eventName === "SessionEnd") {
    await handleSessionEnd(input);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
