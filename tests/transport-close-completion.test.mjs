import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { makeTempDir, run } from "./helpers.mjs";
import { resolveStateDir } from "../plugins/codex/scripts/lib/state.mjs";

const FIXTURE = fileURLToPath(new URL("./transport-close-completion-fixture.mjs", import.meta.url));

test("task emits its inferred result after transport close with no other live handles", () => {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  installFakeCodex(binDir, "final-answer-close");

  const result = run(process.execPath, [FIXTURE, "task", "--json", "finish after transport close"], {
    cwd: repo,
    env: buildEnv(binDir),
    timeout: 5000
  });

  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), "", "expected the production task to emit its inferred result");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 0);
  assert.equal(payload.rawOutput, "Final answer before close.");
  assert.match(result.stderr, /Transport closed before inferred result delivery/);
  const stateDir = resolveStateDir(repo);
  const state = JSON.parse(fs.readFileSync(path.join(stateDir, "state.json"), "utf8"));
  assert.equal(state.jobs[0].status, "completed");
  assert.match(fs.readFileSync(state.jobs[0].logFile, "utf8"), /Turn completion inferred/);
});
