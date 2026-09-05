import fs from "node:fs";
import path from "node:path";

import { loadState, resolveStateFile, saveState, setConfig, upsertJob } from "../plugins/codex/scripts/lib/state.mjs";

const [workspace, barriers, id, operation] = process.argv.slice(2);
const stateFile = resolveStateFile(workspace);
const originalWrite = fs.writeFileSync;
const originalOpen = fs.openSync;
const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

fs.openSync = function(file, ...args) {
  try {
    return originalOpen(file, ...args);
  } catch (error) {
    if (file === `${stateFile}.lock` && error.code === "EEXIST") {
      originalWrite(path.join(barriers, `${id}.waiting`), "waiting");
    }
    throw error;
  }
};

fs.writeFileSync = function(file, ...args) {
  if (file === stateFile || (typeof file === "string" && file.startsWith(`${stateFile}.`) && file.endsWith(".tmp"))) {
    originalWrite(path.join(barriers, `${id}.ready`), "ready");
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(path.join(barriers, `${id}.release`))) {
      if (Date.now() > deadline) {
        throw new Error(`Barrier timeout: ${id}`);
      }
      Atomics.wait(sleepBuffer, 0, 0, 10);
    }
  }
  return originalWrite(file, ...args);
};

if (operation === "saveState") {
  const state = loadState(workspace);
  state.jobs.push({ id, status: "running" });
  saveState(workspace, state);
} else if (operation === "setConfig") {
  setConfig(workspace, id, true);
} else {
  upsertJob(workspace, { id, status: "running" });
}
