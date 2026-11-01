import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { buildEnv, installFakeCodex } from "./fake-codex-fixture.mjs";
import { initGitRepo, makeTempDir, run } from "./helpers.mjs";
import { listJobs, resolveJobFile } from "../plugins/codex/scripts/lib/state.mjs";
import { renderTaskResult } from "../plugins/codex/scripts/lib/render.mjs";

const SCRIPT = fileURLToPath(new URL("../plugins/codex/scripts/codex-companion.mjs", import.meta.url));
const SCHEMA = { type: "object", properties: { status: { type: "string" }, summary: { type: "string" } }, required: ["status", "summary"] };

function fixture(finalMessage = '{"status":"DONE","summary":"done"}', behavior = "review-ok") {
  const repo = makeTempDir();
  const binDir = makeTempDir();
  initGitRepo(repo);
  installFakeCodex(binDir, behavior, { finalMessage });
  const schemaPath = path.join(repo, "output.schema.json");
  fs.writeFileSync(schemaPath, JSON.stringify(SCHEMA));
  const statePath = path.join(binDir, "fake-codex-state.json");
  return {
    repo,
    binDir,
    schemaPath,
    command(args, cwd = repo, env = {}) {
      return run(process.execPath, [SCRIPT, ...args], { cwd, env: { ...buildEnv(binDir), ...env }, timeout: 20000 });
    },
    state() {
      return JSON.parse(fs.readFileSync(statePath, "utf8"));
    },
    updateState(update) {
      const state = this.state();
      update(state);
      fs.writeFileSync(statePath, JSON.stringify(state));
    },
    job() {
      const job = listJobs(repo)[0];
      return { job, stored: JSON.parse(fs.readFileSync(resolveJobFile(repo, job.id), "utf8")) };
    }
  };
}

function start(f) {
  const result = f.command(["task", "--json", "initial"]);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).threadId;
}

function assertReadBeforeResume(f, threadId) {
  const requests = f.state().requests;
  const read = requests.findIndex((request) => request.method === "thread/read");
  const resume = requests.findIndex((request) => request.method === "thread/resume");
  assert.ok(read >= 0 && resume > read);
  assert.deepEqual(requests[read].params, { threadId, includeTurns: false });
}

test("explicit resume checks ownership before resuming the same workspace", () => {
  const f = fixture();
  const threadId = start(f);
  const result = f.command(["task", "--resume-thread", threadId, "follow up"]);
  assert.equal(result.status, 0, result.stderr);
  assertReadBeforeResume(f, threadId);
});

for (const flag of ["--resume-last", "--resume"]) {
  test(`S3 ${flag} checks ownership and forwards the output schema`, () => {
    const f = fixture();
    const threadId = start(f);
    const result = f.command(["task", flag, "--output-schema", f.schemaPath, "follow up"]);
    assert.equal(result.status, 0, result.stderr);
    assertReadBeforeResume(f, threadId);
    assert.deepEqual(f.state().lastTurnStart.outputSchema, SCHEMA);
    assert.equal(f.job().job.resultContract.valid, true);
  });
}

for (const cwdKind of ["another repository", "missing directory", "missing cwd"]) {
  test(`S3 resume refuses ${cwdKind} without resuming or renaming`, () => {
    const f = fixture();
    const threadId = start(f);
    let threadCwd;
    if (cwdKind === "another repository") {
      threadCwd = makeTempDir();
      initGitRepo(threadCwd);
    } else if (cwdKind === "missing directory") {
      threadCwd = path.join(f.repo, "nonexistent");
    }
    f.updateState((state) => {
      state.threads[0].cwd = threadCwd;
      state.requests = [];
    });
    const result = f.command(["task", "--resume-thread", threadId, "--thread-title", "Must not rename", "follow up"]);
    assert.equal(result.status, 1);
    const currentRoot = fs.realpathSync(f.repo);
    const expected = cwdKind === "another repository"
      ? `Codex thread ${threadId} belongs to ${fs.realpathSync(threadCwd)}, not ${currentRoot}; refusing to resume it.`
      : `Codex thread ${threadId} has no usable working directory (${threadCwd ?? "none"}); refusing to resume it from ${currentRoot}.`;
    const { job, stored } = f.job();
    assert.equal(job.status, "failed");
    assert.equal(job.errorMessage, expected);
    assert.equal(stored.errorMessage, expected);
    assert.ok(result.stderr.includes(expected));
    assert.equal(f.state().requests.some(({ method }) => ["thread/resume", "thread/name/set"].includes(method)), false);
  });
}

test("resume canonicalizes nested directories and symlinked roots", () => {
  const f = fixture();
  const threadId = start(f);
  const nested = path.join(f.repo, "nested");
  fs.mkdirSync(nested);
  const alias = path.join(makeTempDir(), "alias");
  fs.symlinkSync(f.repo, alias, "dir");
  f.updateState((state) => { state.threads[0].cwd = path.join(alias, "nested"); });
  const result = f.command(["task", "--resume-thread", threadId, "--output-schema", "../output.schema.json", "follow up"], nested);
  assert.equal(result.status, 0, result.stderr);
  assertReadBeforeResume(f, threadId);
  assert.equal(f.job().job.resultContract.schemaPath, f.schemaPath);
  assert.deepEqual(f.state().lastTurnStart.outputSchema, SCHEMA);
});

test("output schema reaches turn/start and valid status is stored and rendered", () => {
  const f = fixture();
  const result = f.command(["task", "--fresh", "--output-schema", "output.schema.json", "--json", "work"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.state().lastTurnStart.outputSchema, SCHEMA);
  const contract = { schemaPath: f.schemaPath, valid: true, status: "DONE" };
  const { job, stored } = f.job();
  assert.deepEqual(job.resultContract, contract);
  assert.deepEqual(stored.resultContract, contract);
  assert.deepEqual(JSON.parse(result.stdout).resultContract, contract);
  for (const args of [["result", job.id], ["status", job.id]]) {
    const rendered = f.command(args);
    assert.equal(rendered.status, 0, rendered.stderr);
    assert.match(rendered.stdout, /Result contract: valid — status DONE/);
    const json = JSON.parse(f.command([...args, "--json"]).stdout);
    assert.deepEqual(json.job.resultContract, contract);
  }
  assert.match(f.command(["status"]).stdout, /Codex Task \[contract valid\]/);
});

for (const [name, rawOutput, expected] of [
  ["fenced JSON", '```json\n{"status":"DONE","summary":"done"}\n```', { valid: true, status: "DONE" }],
  ["missing required keys in schema order", '  {"unrelated":true}\n', { valid: false, error: "missing required: status, summary" }],
  ["non-JSON", "plain answer", { valid: false }],
  ["array", "[]", { valid: false, error: "not a JSON object" }],
  ["null", "null", { valid: false, error: "not a JSON object" }],
  ["non-string status", '{"status":42,"summary":"done"}', { valid: true }],
  ["empty string status", '{"status":"","summary":"done"}', { valid: true, status: "" }]
]) {
  test(`S3 contract handles ${name} without changing runtime status or raw output`, () => {
    const f = fixture(rawOutput);
    const result = f.command(["task", "--output-schema", f.schemaPath, "work"]);
    assert.equal(result.status, 0, result.stderr);
    const { job, stored } = f.job();
    assert.equal(job.status, "completed");
    assert.equal(stored.result.rawOutput, rawOutput);
    assert.deepEqual(job.resultContract, stored.resultContract);
    if (name === "non-JSON") {
      assert.equal(job.resultContract.valid, false);
      assert.match(job.resultContract.error, /^not JSON: /);
    } else {
      assert.deepEqual(job.resultContract, { schemaPath: f.schemaPath, ...expected });
    }
    if (!expected.valid) {
      assert.ok(f.command(["result", job.id]).stdout.includes(`Result contract: invalid (${job.resultContract.error})`));
      assert.match(f.command(["status"]).stdout, /\[contract invalid\]/);
    }
  });
}

test("schema required keys must be own properties", () => {
  const f = fixture("{}");
  fs.writeFileSync(f.schemaPath, JSON.stringify({ required: ["toString", "__proto__"] }));
  const result = f.command(["task", "--output-schema", f.schemaPath, "work"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.job().job.resultContract.error, "missing required: toString, __proto__");
});

test("schema without required accepts an object", () => {
  const f = fixture("{}");
  fs.writeFileSync(f.schemaPath, "{}");
  const result = f.command(["task", "--output-schema", f.schemaPath, "work"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(f.job().job.resultContract, { schemaPath: f.schemaPath, valid: true });
});

for (const schema of ["missing", "[]", "null", "true", "{"]) {
  test(`S3 rejects schema ${schema} before creating foreground or background jobs`, () => {
    const f = fixture();
    const schemaPath = schema === "missing" ? path.join(f.repo, "absent.json") : f.schemaPath;
    if (schema !== "missing") fs.writeFileSync(schemaPath, schema);
    let reason;
    try { JSON.parse(fs.readFileSync(schemaPath, "utf8")); } catch (error) { reason = error.message; }
    const expected = reason
      ? `--output-schema: cannot read ${schemaPath}: ${reason}\n`
      : `--output-schema: ${schemaPath} is not a JSON object\n`;
    for (const flags of [[], ["--background"]]) {
      const result = f.command(["task", ...flags, "--output-schema", schemaPath, "work"]);
      assert.equal(result.status, 1);
      assert.equal(result.stderr, expected);
      assert.deepEqual(listJobs(f.repo), []);
    }
  });
}

test("task without schema keeps legacy result and status bytes", () => {
  const f = fixture("done");
  const result = f.command(["task", "work"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "done\n");
  const { job, stored } = f.job();
  assert.equal(Object.hasOwn(job, "resultContract"), false);
  assert.equal(Object.hasOwn(stored, "resultContract"), false);
  assert.equal(Object.hasOwn(stored.result, "resultContract"), false);
  assert.equal(renderTaskResult(stored.result, {}), "done\n");
});

test("background task stores its absolute schema path and result contract", () => {
  const f = fixture();
  const launch = f.command(["task", "--background", "--output-schema", "output.schema.json", "--json", "work"]);
  assert.equal(launch.status, 0, launch.stderr);
  const jobId = JSON.parse(launch.stdout).jobId;
  const wait = f.command(["status", jobId, "--wait", "--timeout-ms", "15000", "--poll-interval-ms", "100", "--json"]);
  assert.equal(wait.status, 0, wait.stderr);
  const { job, stored } = f.job();
  assert.equal(job.status, "completed");
  assert.equal(stored.request.outputSchemaPath, f.schemaPath);
  assert.deepEqual(stored.resultContract, { schemaPath: f.schemaPath, valid: true, status: "DONE" });
  assert.deepEqual(job.resultContract, stored.resultContract);
  assert.deepEqual(f.state().lastTurnStart.outputSchema, SCHEMA);
});

for (const behavior of ["terminal-error-buffered", "turn-start-fails"]) {
  test(`S3 failed turn records an invalid contract for ${behavior}`, () => {
    const f = fixture(undefined, behavior);
    const result = f.command(["task", "--output-schema", f.schemaPath, "work"]);
    assert.equal(result.status, 1);
    const { job, stored } = f.job();
    assert.equal(job.status, "failed");
    assert.deepEqual(job.resultContract, { schemaPath: f.schemaPath, valid: false, error: "turn did not complete" });
    assert.deepEqual(stored.resultContract, job.resultContract);
  });
}

test("shared helper removes inherited companion environment and preserves explicit test overrides", () => {
  const names = ["CODEX_COMPANION_SESSION_ID", "CODEX_COMPANION_TRANSCRIPT_PATH", "CODEX_COMPANION_PLUGIN_DATA"];
  const helper = new URL("./helpers.mjs", import.meta.url).href;
  const probe = run(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(helper)}); console.log(JSON.stringify(${JSON.stringify(names)}.map(name => process.env[name] ?? null)));`], {
    env: { ...process.env, ...Object.fromEntries(names.map((name) => [name, "bogus"])) }
  });
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), [null, null, null]);
  const f = fixture();
  const result = f.command(["task", "--json", "work"], f.repo, { CODEX_COMPANION_SESSION_ID: "explicit-test-session" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.job().job.sessionId, "explicit-test-session");
});
