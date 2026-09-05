import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { ensureStateDir, loadState, resolveStateFile } from "../plugins/codex/scripts/lib/state.mjs";
import { makeTempDir } from "./helpers.mjs";

const FIXTURE = fileURLToPath(new URL("./state-lock-reclaim-fixture.mjs", import.meta.url));

async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "Timed out waiting for stale-lock writer barrier");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("concurrent stale-lock reclaimers preserve the fresh owner's lock and both job updates", async (t) => {
  const workspace = makeTempDir();
  const barriers = makeTempDir();
  ensureStateDir(workspace);
  const lockFile = `${resolveStateFile(workspace)}.lock`;
  fs.writeFileSync(lockFile, "");
  const stale = new Date(Date.now() - 60000);
  fs.utimesSync(lockFile, stale, stale);
  t.after(() => fs.rmSync(lockFile, { force: true }));

  function writer(id) {
    const child = spawn(process.execPath, [FIXTURE, workspace, barriers, id], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    t.after(() => child.kill());
    return { exit: once(child, "close"), stderr: () => stderr };
  }

  const reached = (id, name) => fs.existsSync(path.join(barriers, `${id}.${name}`));
  const release = (id, name) => fs.writeFileSync(path.join(barriers, `${id}.${name}-release`), "release");
  const second = writer("job-B");
  await waitFor(() => reached("job-B", "stale-snapshot"));
  const first = writer("job-A");
  await waitFor(() => reached("job-A", "write"));
  release("job-B", "stale-snapshot");
  await waitFor(() => reached("job-B", "write") || reached("job-B", "blocked"));
  release("job-A", "write");
  const [firstCode] = await first.exit;
  assert.equal(firstCode, 0, first.stderr());
  await waitFor(() => reached("job-B", "write"));
  release("job-B", "write");
  const [secondCode] = await second.exit;
  assert.equal(secondCode, 0, second.stderr());
  assert.deepEqual(loadState(workspace).jobs.map((job) => job.id).sort(), ["job-A", "job-B"]);
  assert.equal(fs.existsSync(lockFile), false);
});
