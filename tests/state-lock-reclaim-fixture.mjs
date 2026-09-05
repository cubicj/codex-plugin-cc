import fs from "node:fs";
import path from "node:path";

import { resolveStateFile, upsertJob } from "../plugins/codex/scripts/lib/state.mjs";

const [workspace, barriers, id] = process.argv.slice(2);
const stateFile = resolveStateFile(workspace);
const lockFile = `${stateFile}.lock`;
const originalOpen = fs.openSync;
const originalStat = fs.statSync;
const originalWrite = fs.writeFileSync;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));
let staleSnapshotReleased = false;

function barrier(name) {
  originalWrite(path.join(barriers, `${id}.${name}`), "ready");
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(path.join(barriers, `${id}.${name}-release`))) {
    if (Date.now() > deadline) {
      throw new Error(`Barrier timeout: ${id}.${name}`);
    }
    Atomics.wait(sleepBuffer, 0, 0, 10);
  }
}

fs.statSync = function(file, ...args) {
  const result = originalStat(file, ...args);
  if (id === "job-B" && file === lockFile && !staleSnapshotReleased) {
    barrier("stale-snapshot");
    staleSnapshotReleased = true;
  }
  return result;
};

fs.openSync = function(file, ...args) {
  try {
    return originalOpen(file, ...args);
  } catch (error) {
    if (file === lockFile && error.code === "EEXIST" && staleSnapshotReleased) {
      originalWrite(path.join(barriers, `${id}.blocked`), "blocked");
    }
    throw error;
  }
};

fs.writeFileSync = function(file, ...args) {
  if (file === stateFile || (typeof file === "string" && file.startsWith(`${stateFile}.`) && file.endsWith(".tmp"))) {
    barrier("write");
  }
  return originalWrite(file, ...args);
};

upsertJob(workspace, { id, status: "running" });
