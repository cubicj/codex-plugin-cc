---
description: Delegate investigation, an explicit fix request, or follow-up rescue work to the Codex rescue subagent
argument-hint: "[--background|--wait] [--read-only|--write] [--resume|--resume-thread <thread-id>|--fresh] [--thread-title <text>] [--model <model|spark>] [--effort <none|minimal|low|medium|high|xhigh|max|ultra>] [--output-schema <file>] [what Codex should investigate, solve, or continue]"
allowed-tools: Bash(node:*), AskUserQuestion, Agent
---

Invoke the `codex:codex-rescue` subagent via the `Agent` tool (`subagent_type: "codex:codex-rescue"`), forwarding the user request with the execution mode and resume route resolved below.
`codex:codex-rescue` is a subagent, not a skill — do not call `Skill(codex:codex-rescue)` (no such skill) or `Skill(codex:rescue)` (that re-enters this command and hangs the session). The command runs inline so the `Agent` tool stays in scope; forked general-purpose subagents do not expose it.
Preserve the requested payload, including code and exact evidence, verbatim. User-facing framing follows the user's language rule; when raw output is explicitly requested, return that payload unchanged.

Raw user request:
$ARGUMENTS

Execution mode:

- If the request includes `--background`, run the `codex:codex-rescue` subagent in the background.
- If the request includes `--wait`, run the `codex:codex-rescue` subagent in the foreground.
- If neither flag is present, default to foreground.
- Pass the resolved mode explicitly to the subagent as `Execution mode: foreground` or `Execution mode: background`, alongside the request. This command owns the decision; the forwarder must not choose again or include the mode metadata in the worker prompt.
- `--background` and `--wait` are execution flags for Claude Code. Do not forward them to `task`, and do not treat them as part of the natural-language task text.
- `--model`, `--effort`, `--read-only`, and `--write` are runtime-selection flags. Preserve them for the forwarded `task` call, but do not treat them as part of the natural-language task text.
- `--output-schema <file>` is a runtime control. Preserve it and its value for the forwarded `task` call, and strip both from the natural-language task text.
- `--thread-title <text>` is a runtime control that sets or renames the Codex thread. Preserve it and its value for the forwarded `task` call, and strip both from the natural-language task text.
- With neither sandbox flag, the task inherits `sandbox_mode` from `config.toml`; on the operator's machine this resolves to `danger-full-access`. `--read-only` pins a read-only sandbox; `--write` pins `workspace-write`.
- Before resolving a resume, use the current session's job records (`status --json` when needed) to identify its task and thread. When more than one task exists in the session, forward the intended task's `--resume-thread <thread-id>` instead of `--resume` or `--resume-last`.
- If the request includes `--resume`, do not ask whether to continue. The user already chose; resolve its target as above.
- If the request includes `--resume-thread <thread-id>`, do not ask whether to continue. The user supplied the durable cross-session thread route.
- If the request includes `--fresh`, do not ask whether to continue. The user already chose.
- Otherwise, before starting Codex, check for a resumable rescue thread from this Claude session by running:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task-resume-candidate --json
```

- If that helper reports `available: true`, use `AskUserQuestion` exactly once to ask whether to continue the current Codex thread or start a new one.
- The two choices must be:
  - `Continue current Codex thread`
  - `Start a new Codex thread`
- If the user is clearly giving a follow-up instruction such as "continue", "keep going", "resume", "apply the top fix", or "dig deeper", put `Continue current Codex thread (Recommended)` first.
- Otherwise put `Start a new Codex thread (Recommended)` first.
- If the user chooses continue, forward the selected thread with `--resume-thread <thread-id>` when more than one session task exists; otherwise add `--resume`.
- If the user chooses a new thread, add `--fresh` before routing to the subagent.
- If the helper reports `available: false`, do not ask. Route normally.

Operating rules:

- The subagent is a thin forwarder only. It should use one `Bash` call to invoke `node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" task ...` and return that command's stdout as-is.
- Do not ask the subagent to inspect files, monitor progress, poll `/codex:status`, fetch `/codex:result`, call `/codex:cancel`, summarize output, or do follow-up work of its own.
- Leave `--effort` unset unless the user explicitly asks for a specific reasoning effort.
- Leave the model unset unless the user explicitly asks for one. If they ask for `spark`, map it to `gpt-5.3-codex-spark`.
- Leave `--resume`, `--resume-thread <thread-id>`, and `--fresh` in the forwarded request. The subagent handles that routing when it builds the `task` command.
- The subagent must assemble the [Worker Envelope and missing-context block](../skills/codex-prompting/references/prompt-blocks.md) around the user's task text according to `codex-cli-runtime`.
- If invocation fails, preserve the actionable stderr lines and exit status returned by the forwarder. If Codex is missing or unauthenticated, tell the user to run `/codex:setup`; do not generate a substitute task answer.
- If the user did not supply a request, ask what Codex should investigate or fix.
