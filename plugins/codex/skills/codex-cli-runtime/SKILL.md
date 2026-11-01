---
name: codex-cli-runtime
description: Internal helper contract for calling the codex-companion runtime from Claude Code
user-invocable: false
---

# Codex Runtime

Use this skill only inside the explicitly invoked `codex:codex-rescue` subagent.

## Invocation

Use exactly one `Bash` call to invoke `task`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task -- "<composed prompt>"
```

Pass runtime controls as separate argv elements before `--`, then one shell-quoted composed prompt operand. Never pass the composed envelope as the lone raw-arguments operand: that form reparses whitespace, quotes, and embedded option tokens.

The rescue command selects foreground or background Agent execution and passes the resolved mode in the handoff. Honor it without reconsidering task complexity. Strip `--background` and `--wait` from the forwarded request; they control Claude-side execution on this path, not the `task` call.

## Runtime controls

- Leave model and effort unset unless explicitly requested. Pass `--model` and `--effort` through; normalize `spark` to `gpt-5.3-codex-spark`. Effort values are `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, and `ultra`; Codex validates model support.
- Leave sandbox flags unset to inherit `config.toml`. Preserve an explicit `--read-only` or `--write` pin.
- Pass `--output-schema <file>` through. It resolves against the command cwd, must contain a JSON object, and supplies the turn's output schema for fresh or resumed tasks.
- Pass `--thread-title <text>` through to set or rename the thread. The runtime trims, collapses whitespace, and shortens it to 56 characters; a blank title retains default naming behavior.
- Map `--resume` to `--resume-last`; preserve explicit `--resume-thread <thread-id>`. When more than one task exists in the Claude session, the controller must supply the intended task's `--resume-thread <thread-id>` instead of implicit latest-task selection.
- `--resume-last` is scoped to the current Claude session. `--resume-thread <thread-id>` also works across sessions in the same workspace. Every resume checks the thread's canonical workspace before resuming or renaming it; missing, unusable, or different workspace roots are refused.
- `--fresh` selects a fresh task. Use the route resolved by the command rather than inferring another route from the task text.

## Forwarding

Use `codex-prompting` only to assemble its mandatory [Worker Envelope](../codex-prompting/references/prompt-blocks.md#worker-envelope) and `missing_context_gating` around the user's task text. Preserve that text verbatim after removing runtime controls and their values.

Do not inspect the repository, solve the task, run other helper commands, monitor progress, fetch results, cancel jobs, or perform follow-up work. Return the task stdout unchanged to the controller, without commentary. If invocation fails, return the actionable stderr lines and exit status without generating a substitute task answer.
