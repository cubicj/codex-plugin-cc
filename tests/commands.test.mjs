import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_ROOT = path.join(ROOT, "plugins", "codex");

function read(relativePath) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, relativePath), "utf8");
}

test("continue is not exposed as a user-facing command", () => {
  assert.equal(fs.existsSync(path.join(PLUGIN_ROOT, "commands", "continue.md")), false);
});

test("rescue command routes inline to the rescue subagent", () => {
  const rescue = read("commands/rescue.md");
  assert.match(rescue, /allowed-tools:\s*Bash\(node:\*\),\s*AskUserQuestion,\s*Agent/);
  // Regression for #234: `Skill(codex:rescue)` from the main agent recursed
  // because rescue.md named the routing with ambiguous prose ("Route this
  // request to the `codex:codex-rescue` subagent") while running under
  // `context: fork` — forked general-purpose subagents do not expose the
  // `Agent` tool, so the fork fell back to `Skill` and re-entered this
  // command. Pin the explicit transport and the inline (no-fork) execution.
  assert.match(rescue, /subagent_type: "codex:codex-rescue"/);
  assert.doesNotMatch(rescue, /^context:\s*fork\b/m);
});

test("transfer, result, and cancel commands are exposed as deterministic runtime entrypoints", () => {
  const transfer = read("commands/transfer.md");
  const result = read("commands/result.md");
  const cancel = read("commands/cancel.md");
  assert.match(transfer, /disable-model-invocation:\s*true/);
  assert.match(transfer, /codex-companion\.mjs" transfer "\$ARGUMENTS"/);
  assert.match(result, /disable-model-invocation:\s*true/);
  assert.match(result, /codex-companion\.mjs" result "\$ARGUMENTS"/);
  assert.match(cancel, /disable-model-invocation:\s*true/);
  assert.match(cancel, /codex-companion\.mjs" cancel "\$ARGUMENTS"/);
});

test("hooks keep session-end cleanup and stop gating enabled", () => {
  const source = read("hooks/hooks.json");
  assert.match(source, /SessionStart/);
  assert.match(source, /SessionEnd/);
  assert.match(source, /stop-review-gate-hook\.mjs/);
  assert.match(source, /session-lifecycle-hook\.mjs/);
});

test("setup command runs the companion setup entrypoint", () => {
  const setup = read("commands/setup.md");
  assert.match(setup, /codex-companion\.mjs" setup --json \$ARGUMENTS/);
});
