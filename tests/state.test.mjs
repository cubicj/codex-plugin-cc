import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import { makeTempDir } from "./helpers.mjs";
import {
  loadState,
  resolveJobFile,
  resolveJobLogFile,
  resolveStateDir,
  resolveStateFile,
  saveState,
  updateState,
  upsertJob,
  writeJobFile
} from "../plugins/codex/scripts/lib/state.mjs";

test("resolveStateDir uses a temp-backed per-workspace directory", () => {
  const workspace = makeTempDir();
  const previousCodexPluginDataDir = process.env.CODEX_COMPANION_PLUGIN_DATA;
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CODEX_COMPANION_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(os.tmpdir()), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(stateDir, new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  } finally {
    if (previousCodexPluginDataDir == null) {
      delete process.env.CODEX_COMPANION_PLUGIN_DATA;
    } else {
      process.env.CODEX_COMPANION_PLUGIN_DATA = previousCodexPluginDataDir;
    }
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("resolveStateDir falls back to CLAUDE_PLUGIN_DATA when it is provided", () => {
  const workspace = makeTempDir();
  const pluginDataDir = makeTempDir();
  const previousCodexPluginDataDir = process.env.CODEX_COMPANION_PLUGIN_DATA;
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CODEX_COMPANION_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = pluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(path.join(pluginDataDir, "state")), true);
    assert.match(path.basename(stateDir), /.+-[a-f0-9]{16}$/);
    assert.match(
      stateDir,
      new RegExp(`^${path.join(pluginDataDir, "state").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
    );
  } finally {
    if (previousCodexPluginDataDir == null) {
      delete process.env.CODEX_COMPANION_PLUGIN_DATA;
    } else {
      process.env.CODEX_COMPANION_PLUGIN_DATA = previousCodexPluginDataDir;
    }
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("resolveStateDir prefers the Codex plugin data dir over another plugin's host-scoped value", () => {
  const workspace = makeTempDir();
  const codexPluginDataDir = makeTempDir();
  const siblingPluginDataDir = makeTempDir();
  const previousCodexPluginDataDir = process.env.CODEX_COMPANION_PLUGIN_DATA;
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CODEX_COMPANION_PLUGIN_DATA = codexPluginDataDir;
  process.env.CLAUDE_PLUGIN_DATA = siblingPluginDataDir;

  try {
    const stateDir = resolveStateDir(workspace);

    assert.equal(stateDir.startsWith(path.join(codexPluginDataDir, "state")), true);
    assert.equal(stateDir.startsWith(path.join(siblingPluginDataDir, "state")), false);
  } finally {
    if (previousCodexPluginDataDir == null) {
      delete process.env.CODEX_COMPANION_PLUGIN_DATA;
    } else {
      process.env.CODEX_COMPANION_PLUGIN_DATA = previousCodexPluginDataDir;
    }
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("saveState does not prune another plugin's job when the host-scoped data dir was overwritten", () => {
  const workspace = makeTempDir();
  const codexPluginDataDir = makeTempDir();
  const siblingPluginDataDir = makeTempDir();
  const previousCodexPluginDataDir = process.env.CODEX_COMPANION_PLUGIN_DATA;
  const previousPluginDataDir = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CODEX_COMPANION_PLUGIN_DATA = siblingPluginDataDir;
  process.env.CLAUDE_PLUGIN_DATA = siblingPluginDataDir;

  try {
    const siblingStateFile = resolveStateFile(workspace);
    const siblingJobFile = resolveJobFile(workspace, "sibling-job");
    const siblingLogFile = resolveJobLogFile(workspace, "sibling-job");
    const siblingState = {
      version: 1,
      config: { stopReviewGate: false },
      jobs: [
        {
          id: "sibling-job",
          status: "completed",
          logFile: siblingLogFile,
          createdAt: "2026-08-25T00:00:00.000Z",
          updatedAt: "2026-08-25T00:00:00.000Z"
        }
      ]
    };
    fs.writeFileSync(siblingJobFile, '{"owner":"sibling"}\n', "utf8");
    fs.writeFileSync(siblingLogFile, "sibling output\n", "utf8");
    fs.writeFileSync(siblingStateFile, `${JSON.stringify(siblingState, null, 2)}\n`, "utf8");

    process.env.CODEX_COMPANION_PLUGIN_DATA = codexPluginDataDir;
    saveState(workspace, {
      version: 1,
      config: { stopReviewGate: false },
      jobs: []
    });

    assert.deepEqual(JSON.parse(fs.readFileSync(siblingStateFile, "utf8")), siblingState);
    assert.equal(fs.readFileSync(siblingJobFile, "utf8"), '{"owner":"sibling"}\n');
    assert.equal(fs.readFileSync(siblingLogFile, "utf8"), "sibling output\n");
    assert.equal(fs.existsSync(resolveStateFile(workspace)), true);
  } finally {
    if (previousCodexPluginDataDir == null) {
      delete process.env.CODEX_COMPANION_PLUGIN_DATA;
    } else {
      process.env.CODEX_COMPANION_PLUGIN_DATA = previousCodexPluginDataDir;
    }
    if (previousPluginDataDir == null) {
      delete process.env.CLAUDE_PLUGIN_DATA;
    } else {
      process.env.CLAUDE_PLUGIN_DATA = previousPluginDataDir;
    }
  }
});

test("saveState prunes dropped job artifacts when indexed jobs exceed the cap", () => {
  const workspace = makeTempDir();
  const stateFile = resolveStateFile(workspace);
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });

  const jobs = Array.from({ length: 51 }, (_, index) => {
    const jobId = `job-${index}`;
    const updatedAt = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
    const logFile = resolveJobLogFile(workspace, jobId);
    const jobFile = resolveJobFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    fs.writeFileSync(jobFile, JSON.stringify({ id: jobId, status: "completed" }, null, 2), "utf8");
    return {
      id: jobId,
      status: "completed",
      logFile,
      updatedAt,
      createdAt: updatedAt
    };
  });

  fs.writeFileSync(
    stateFile,
    `${JSON.stringify(
      {
        version: 1,
        config: { stopReviewGate: false },
        jobs
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  saveState(workspace, {
    version: 1,
    config: { stopReviewGate: false },
    jobs
  });

  const prunedJobFile = resolveJobFile(workspace, "job-0");
  const prunedLogFile = resolveJobLogFile(workspace, "job-0");
  const retainedJobFile = resolveJobFile(workspace, "job-50");
  const retainedLogFile = resolveJobLogFile(workspace, "job-50");
  const jobsDir = path.dirname(prunedJobFile);

  assert.equal(fs.existsSync(retainedJobFile), true);
  assert.equal(fs.existsSync(retainedLogFile), true);

  const savedState = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  assert.equal(savedState.jobs.length, 50);
  assert.deepEqual(
    savedState.jobs.map((job) => job.id),
    Array.from({ length: 50 }, (_, index) => `job-${50 - index}`)
  );
  assert.deepEqual(
    fs.readdirSync(jobsDir).sort(),
    Array.from({ length: 50 }, (_, index) => `job-${index + 1}`)
      .flatMap((jobId) => [`${jobId}.json`, `${jobId}.log`])
      .sort()
  );
});

test("saveState with a stale snapshot does not destroy a concurrently written job", () => {
  const workspace = makeTempDir();

  // Process A: seed job-A and load a snapshot that only knows about it.
  upsertJob(workspace, {
    id: "job-A",
    status: "completed",
    logFile: resolveJobLogFile(workspace, "job-A")
  });
  const staleSnapshot = loadState(workspace);

  // Process B: record job-B along with its result and log files.
  const jobBLogFile = resolveJobLogFile(workspace, "job-B");
  fs.writeFileSync(jobBLogFile, "log job-B\n", "utf8");
  writeJobFile(workspace, "job-B", { id: "job-B", status: "completed" });
  upsertJob(workspace, {
    id: "job-B",
    status: "completed",
    logFile: jobBLogFile
  });

  // Process A saves its stale snapshot; job-B must survive untouched.
  saveState(workspace, staleSnapshot);

  const savedState = JSON.parse(fs.readFileSync(resolveStateFile(workspace), "utf8"));
  assert.deepEqual(savedState.jobs.map((job) => job.id).sort(), ["job-A", "job-B"]);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-B")), true);
  assert.equal(fs.existsSync(jobBLogFile), true);
});

test("saveState removes ledger entries and artifacts for explicitly removed jobs", () => {
  const workspace = makeTempDir();

  for (const jobId of ["job-keep", "job-drop"]) {
    const logFile = resolveJobLogFile(workspace, jobId);
    fs.writeFileSync(logFile, `log ${jobId}\n`, "utf8");
    writeJobFile(workspace, jobId, { id: jobId, status: "completed" });
    upsertJob(workspace, {
      id: jobId,
      status: "completed",
      logFile
    });
  }

  const state = loadState(workspace);
  saveState(
    workspace,
    {
      ...state,
      jobs: state.jobs.filter((job) => job.id !== "job-drop")
    },
    { removedJobIds: ["job-drop"] }
  );

  const savedState = JSON.parse(fs.readFileSync(resolveStateFile(workspace), "utf8"));
  assert.deepEqual(savedState.jobs.map((job) => job.id), ["job-keep"]);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-drop")), false);
  assert.equal(fs.existsSync(resolveJobLogFile(workspace, "job-drop")), false);
  assert.equal(fs.existsSync(resolveJobFile(workspace, "job-keep")), true);
  assert.equal(fs.existsSync(resolveJobLogFile(workspace, "job-keep")), true);
});

async function waitForBarrier(predicate) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "State writer did not reach its barrier");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

for (const operation of ["upsertJob", "saveState", "setConfig"]) {
  test(`${operation} serializes cross-process state updates`, async (t) => {
    const workspace = makeTempDir();
    const barriers = makeTempDir();
    const children = [];
    t.after(() => {
      for (const child of children) {
        if (child.exitCode === null) {
          child.kill();
        }
      }
    });
    const reached = (id, phase) => fs.existsSync(path.join(barriers, `${id}.${phase}`));
    const release = (id) => fs.writeFileSync(path.join(barriers, `${id}.release`), "release");
    const startWriter = (id) => {
      const child = spawn(process.execPath, [
        fileURLToPath(new URL("./state-writer-fixture.mjs", import.meta.url)),
        workspace,
        barriers,
        id,
        operation
      ], { env: process.env });
      children.push(child);
      let output = "";
      child.stderr.on("data", (data) => { output += data; });
      return new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve({ code, output }));
      });
    };

    const writerA = startWriter("job-A");
    await waitForBarrier(() => reached("job-A", "ready"));
    const writerB = startWriter("job-B");
    await waitForBarrier(() => reached("job-B", "ready") || reached("job-B", "waiting"));
    release("job-A");
    const resultA = await writerA;
    assert.equal(resultA.code, 0, resultA.output);
    await waitForBarrier(() => reached("job-B", "ready"));
    release("job-B");
    const resultB = await writerB;
    assert.equal(resultB.code, 0, resultB.output);

    const saved = loadState(workspace);
    if (operation === "setConfig") {
      assert.equal(saved.config["job-A"], true);
      assert.equal(saved.config["job-B"], true);
    } else {
      assert.deepEqual(saved.jobs.map((job) => job.id).sort(), ["job-A", "job-B"]);
    }
    assert.equal(fs.existsSync(`${resolveStateFile(workspace)}.lock`), false);
  });
}

test("updateState releases its lock when mutation throws", () => {
  const workspace = makeTempDir();
  assert.throws(() => updateState(workspace, () => { throw new Error("mutation failed"); }), /mutation failed/);
  upsertJob(workspace, { id: "after-error", status: "queued" });
  assert.deepEqual(loadState(workspace).jobs.map((job) => job.id), ["after-error"]);
  assert.equal(fs.existsSync(`${resolveStateFile(workspace)}.lock`), false);
});

test("updateState reclaims an abandoned lock", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, "");
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockFile, old, old);
  upsertJob(workspace, { id: "after-stale-lock", status: "queued" });
  assert.equal(loadState(workspace).jobs[0].id, "after-stale-lock");
  assert.equal(fs.existsSync(lockFile), false);
});

test("saveState publishes atomically and preserves state when rename fails", (t) => {
  const workspace = makeTempDir();
  upsertJob(workspace, { id: "original", status: "queued" });
  const stateFile = resolveStateFile(workspace);
  const original = fs.readFileSync(stateFile, "utf8");
  let renameAttempts = 0;
  const rename = t.mock.method(fs, "renameSync", (source, destination) => {
    assert.equal(destination, stateFile);
    assert.equal(path.dirname(source), path.dirname(stateFile));
    assert.equal(fs.readFileSync(stateFile, "utf8"), original);
    assert.deepEqual(JSON.parse(fs.readFileSync(source, "utf8")).jobs.map((job) => job.id).sort(), ["next", "original"]);
    renameAttempts += 1;
    throw new Error("rename failed");
  });
  assert.throws(() => upsertJob(workspace, { id: "next", status: "queued" }), /rename failed/);
  assert.equal(renameAttempts, 1);
  assert.equal(fs.readFileSync(stateFile, "utf8"), original);
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)).sort(), ["jobs", "state.json"]);
  rename.mock.restore();
  upsertJob(workspace, { id: "retry", status: "queued" });
  assert.deepEqual(loadState(workspace).jobs.map((job) => job.id).sort(), ["original", "retry"]);
});


test("updateState times out without changing a live lock or state", (t) => {
  const workspace = makeTempDir();
  upsertJob(workspace, { id: "original", status: "queued" });
  const stateFile = resolveStateFile(workspace);
  const original = fs.readFileSync(stateFile, "utf8");
  const lockFile = `${stateFile}.lock`;
  fs.writeFileSync(lockFile, "held");
  let now = Date.now();
  const clock = t.mock.method(Date, "now", () => {
    now += 1000;
    return now;
  });
  assert.throws(() => upsertJob(workspace, { id: "blocked", status: "queued" }), /Timed out waiting for state lock/);
  clock.mock.restore();
  assert.equal(fs.readFileSync(lockFile, "utf8"), "held");
  assert.equal(fs.readFileSync(stateFile, "utf8"), original);
  fs.unlinkSync(lockFile);
});

test("updateState does not release a replacement lock", () => {
  const workspace = makeTempDir();
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  assert.throws(() => updateState(workspace, () => {
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, "replacement");
    throw new Error("ownership lost");
  }), /ownership lost/);
  assert.equal(fs.readFileSync(lockFile, "utf8"), "replacement");
  fs.unlinkSync(lockFile);
});

test("saveState releases its lock and temporary file when writing fails", (t) => {
  const workspace = makeTempDir();
  upsertJob(workspace, { id: "original", status: "queued" });
  const stateFile = resolveStateFile(workspace);
  const original = fs.readFileSync(stateFile, "utf8");
  const writeFile = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (file, ...args) => {
    if (typeof file === "string" && file.startsWith(`${stateFile}.`) && file.endsWith(".tmp")) {
      writeFile(file, "partial");
      throw new Error("write failed");
    }
    return writeFile(file, ...args);
  });
  assert.throws(() => upsertJob(workspace, { id: "next", status: "queued" }), /write failed/);
  assert.equal(fs.readFileSync(stateFile, "utf8"), original);
  assert.deepEqual(fs.readdirSync(path.dirname(stateFile)).sort(), ["jobs", "state.json"]);
});


test("updateState bounds contention on the stale-lock reclamation guard", (t) => {
  const workspace = makeTempDir();
  upsertJob(workspace, { id: "original", status: "queued" });
  const stateFile = resolveStateFile(workspace);
  const original = fs.readFileSync(stateFile, "utf8");
  const lockFile = `${stateFile}.lock`;
  const reclaimFile = `${lockFile}.reclaim`;
  fs.writeFileSync(lockFile, "stale");
  fs.writeFileSync(reclaimFile, "held");
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockFile, old, old);
  const future = new Date(Date.now() + 3600000);
  fs.utimesSync(reclaimFile, future, future);
  let now = Date.now();
  const clock = t.mock.method(Date, "now", () => {
    now += 1000;
    return now;
  });
  assert.throws(() => upsertJob(workspace, { id: "blocked", status: "queued" }), /Timed out waiting for state lock/);
  clock.mock.restore();
  assert.equal(fs.readFileSync(lockFile, "utf8"), "stale");
  assert.equal(fs.readFileSync(reclaimFile, "utf8"), "held");
  assert.equal(fs.readFileSync(stateFile, "utf8"), original);
  fs.unlinkSync(reclaimFile);
  upsertJob(workspace, { id: "retry", status: "queued" });
  assert.deepEqual(loadState(workspace).jobs.map((job) => job.id).sort(), ["original", "retry"]);
  assert.equal(fs.existsSync(reclaimFile), false);
});

test("updateState reclaims an abandoned reclamation guard", () => {
  const workspace = makeTempDir();
  upsertJob(workspace, { id: "original", status: "queued" });
  const stateFile = resolveStateFile(workspace);
  const lockFile = `${stateFile}.lock`;
  const reclaimFile = `${lockFile}.reclaim`;
  fs.writeFileSync(lockFile, "stale");
  fs.writeFileSync(reclaimFile, "orphaned");
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(lockFile, old, old);
  fs.utimesSync(reclaimFile, old, old);

  upsertJob(workspace, { id: "retry", status: "queued" });

  assert.deepEqual(loadState(workspace).jobs.map((job) => job.id).sort(), ["original", "retry"]);
  assert.equal(fs.existsSync(lockFile), false);
  assert.equal(fs.existsSync(reclaimFile), false);
});
