import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildSingleJobSnapshot, buildStatusSnapshot, resolveCancelableJob, resolveResultJob } from "../plugins/codex/scripts/lib/job-control.mjs";
import { resolveJobFile, resolveStateDir } from "../plugins/codex/scripts/lib/state.mjs";
import { makeTempDir, run } from "./helpers.mjs";

const SCRIPT = fileURLToPath(new URL("../plugins/codex/scripts/codex-companion.mjs", import.meta.url));

function deadWorkerPid() {
  const child = run(process.execPath, ["-e", ""]);
  assert.equal(child.status, 0, child.stderr);
  assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  return child.pid;
}

function storedJob(patch = {}) {
  const workspace = makeTempDir();
  const job = {
    id: "task-worker",
    kind: "task",
    jobClass: "task",
    status: "running",
    phase: "investigating",
    summary: "Working on the task",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...patch
  };
  const stateFile = path.join(resolveStateDir(workspace), "state.json");
  const jobFile = resolveJobFile(workspace, job.id);
  fs.mkdirSync(path.dirname(jobFile), { recursive: true });
  const stateText = JSON.stringify({ version: 1, config: { stopReviewGate: false }, jobs: [job] });
  const jobText = JSON.stringify(job);
  fs.writeFileSync(stateFile, stateText);
  fs.writeFileSync(jobFile, jobText);
  return {
    workspace,
    job,
    assertUnchanged() {
      assert.equal(fs.readFileSync(stateFile, "utf8"), stateText);
      assert.equal(fs.readFileSync(jobFile, "utf8"), jobText);
    }
  };
}

function companion(fixture, args, env = process.env) {
  return run(process.execPath, [SCRIPT, ...args], { cwd: fixture.workspace, env, timeout: 5000 });
}

function assertWorkerExited(job) {
  assert.equal(job.status, "failed");
  assert.equal(job.phase, "worker-exited");
  assert.match(job.summary, /worker process exited without recording a result/i);
}

for (const status of ["queued", "running"]) {
  test(`status projects a ${status} job with a dead worker as failed without writing state`, () => {
    const fixture = storedJob({ status, pid: deadWorkerPid() });
    const single = companion(fixture, ["status", fixture.job.id, "--json"]);
    assert.equal(single.status, 0, single.stderr);
    assertWorkerExited(JSON.parse(single.stdout).job);
    const listing = companion(fixture, ["status", "--json"]);
    assert.equal(listing.status, 0, listing.stderr);
    const payload = JSON.parse(listing.stdout);
    assert.deepEqual(payload.running, []);
    assertWorkerExited(payload.latestFinished);
    fixture.assertUnchanged();
  });
}

test("status --wait ends without timing out for a dead worker", () => {
  const fixture = storedJob({ pid: deadWorkerPid() });
  const result = companion(fixture, ["status", fixture.job.id, "--wait", "--timeout-ms", "25", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.waitTimedOut, false);
  assertWorkerExited(payload.job);
  fixture.assertUnchanged();
});

test("status --wait notices a worker that exits after its first active snapshot", async (t) => {
  const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const workerExit = once(worker, "exit");
  t.after(() => worker.kill());
  await once(worker, "spawn");
  const fixture = storedJob({ pid: worker.pid });
  const barrier = path.join(fixture.workspace, "snapshot-ready");
  const preload = path.join(fixture.workspace, "snapshot-barrier.cjs");
  const stateFile = path.join(resolveStateDir(fixture.workspace), "state.json");
  fs.writeFileSync(preload, `
const fs = require("node:fs");
const readFileSync = fs.readFileSync;
let observed = false;
fs.readFileSync = function(file, ...args) {
  const result = readFileSync.call(this, file, ...args);
  if (file === ${JSON.stringify(stateFile)} && !observed) {
    observed = true;
    queueMicrotask(() => fs.writeFileSync(${JSON.stringify(barrier)}, "ready"));
  }
  return result;
};
`);
  const watcher = spawn(process.execPath, [
    "--require", preload, SCRIPT, "status", fixture.job.id, "--wait", "--timeout-ms", "1000",
    "--poll-interval-ms", "100", "--json"
  ], { cwd: fixture.workspace, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  const watcherExit = once(watcher, "close");
  t.after(() => watcher.kill());
  let stdout = "";
  let stderr = "";
  watcher.stdout.on("data", (chunk) => { stdout += chunk; });
  watcher.stderr.on("data", (chunk) => { stderr += chunk; });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(barrier) && Date.now() < deadline && watcher.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(fs.existsSync(barrier), true, stderr);
  assert.equal(process.kill(worker.pid, 0), true);
  worker.kill();
  await workerExit;
  assert.throws(() => process.kill(worker.pid, 0), { code: "ESRCH" });
  const [code] = await watcherExit;
  assert.equal(code, 0, stderr);
  const payload = JSON.parse(stdout);
  assert.equal(payload.waitTimedOut, false);
  assertWorkerExited(payload.job);
  fixture.assertUnchanged();
});

test("result resolves a dead worker as failed without a stored result", () => {
  const fixture = storedJob({ pid: deadWorkerPid() });
  for (const reference of [[fixture.job.id], []]) {
    const result = companion(fixture, ["result", ...reference, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assertWorkerExited(payload.job);
    assert.equal(payload.recovered, null);
    assert.equal(payload.storedJob.status, "running");
  }
  fixture.assertUnchanged();
});

test("result recovers a dead worker's completed rollout and retains the recovered label", () => {
  const fixture = storedJob({ pid: deadWorkerPid(), threadId: "thread-worker", turnId: "turn-worker" });
  const codexHome = makeTempDir();
  const sessions = path.join(codexHome, "sessions", "2026", "09", "05");
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, "rollout-2026-09-05-thread-worker.jsonl"), JSON.stringify({
    type: "event_msg",
    payload: { type: "task_complete", turn_id: "turn-worker", last_agent_message: "The completed answer." }
  }) + "\n");
  const env = { ...process.env, CODEX_HOME: codexHome };
  const result = companion(fixture, ["result", fixture.job.id, "--json"], env);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assertWorkerExited(payload.job);
  assert.equal(payload.recovered.text, "The completed answer.");
  assert.equal(payload.recovered.complete, true);
  const rendered = companion(fixture, ["result", fixture.job.id], env);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /Recovered from the Codex transcript/);
  assert.match(rendered.stdout, /The completed answer\./);
  fixture.assertUnchanged();
});

test("cancel resolution excludes dead workers without persisting a cancellation", () => {
  const fixture = storedJob({ pid: deadWorkerPid() });
  assert.throws(() => resolveCancelableJob(fixture.workspace, ""), /No active Codex jobs to cancel\./);
  const result = companion(fixture, ["cancel", fixture.job.id, "--json"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No job found/);
  fixture.assertUnchanged();
});

for (const errorCode of [null, "EPERM", "EINVAL", undefined]) {
  test(`job lookups preserve active workers when the liveness probe ${errorCode === null ? "succeeds" : `throws ${errorCode}`}`, (t) => {
    const fixture = storedJob({ pid: process.pid });
    const kill = t.mock.method(process, "kill", (pid, signal) => {
      assert.equal(pid, process.pid);
      assert.equal(signal, 0);
      if (errorCode !== null) {
        throw Object.assign(new Error("probe failed"), { code: errorCode });
      }
      return true;
    });
    assert.equal(buildSingleJobSnapshot(fixture.workspace, fixture.job.id).job.status, "running");
    assert.equal(buildStatusSnapshot(fixture.workspace).running[0].status, "running");
    assert.equal(resolveCancelableJob(fixture.workspace, fixture.job.id).job.status, "running");
    assert.throws(() => resolveResultJob(fixture.workspace, fixture.job.id), {
      message: `Job ${fixture.job.id} is still running. Check /codex:status and try again once it finishes.`
    });
    assert.equal(kill.mock.callCount(), 4);
    fixture.assertUnchanged();
  });
}

test("job lookups leave pid-less and invalid-pid records untouched", (t) => {
  const kill = t.mock.method(process, "kill", () => {
    throw new Error("Must not probe a job without a finite positive pid");
  });
  for (const pid of [undefined, null, 0, -1, "123", Infinity]) {
    const fixture = storedJob({ pid });
    assert.equal(buildSingleJobSnapshot(fixture.workspace, fixture.job.id).job.status, "running");
    assert.equal(resolveCancelableJob(fixture.workspace, fixture.job.id).job.status, "running");
    assert.throws(() => resolveResultJob(fixture.workspace, fixture.job.id), /is still running/);
    fixture.assertUnchanged();
  }
  assert.equal(kill.mock.callCount(), 0);
});

test("job lookups leave finished records untouched even when their worker is dead", (t) => {
  const kill = t.mock.method(process, "kill", () => {
    throw Object.assign(new Error("gone"), { code: "ESRCH" });
  });
  for (const status of ["completed", "failed", "cancelled"]) {
    const fixture = storedJob({ status, pid: process.pid });
    assert.equal(buildSingleJobSnapshot(fixture.workspace, fixture.job.id).job.status, status);
    assert.equal(resolveResultJob(fixture.workspace, fixture.job.id).job.status, status);
    fixture.assertUnchanged();
  }
  assert.equal(kill.mock.callCount(), 0);
});
