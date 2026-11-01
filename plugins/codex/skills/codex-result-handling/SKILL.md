---
name: codex-result-handling
description: Internal guidance for presenting Codex helper output back to the user
user-invocable: false
---

# Codex Result Handling

Present findings by severity, preserving exact paths, line numbers, evidence, uncertainty, and requested output sections. State when there are no findings, which files changed, and what remains unverified. User-facing framing follows the user's language rule; preserve requested raw payloads and exact evidence verbatim.

When output is recovered from a rollout transcript, preserve the recovered-output label, `PARTIAL` marker, transcript source, and warning that the turn may not have finished.

Treat runtime completion, output-contract validity, and the worker's task status as separate signals. With `--output-schema`, local checks parse JSON (including a whole-message fence), require an object, and check top-level required keys; Codex enforces the remaining schema constraints. Raw output is preserved. An invalid contract does not change a completed job to failed, and a valid contract with task status `BLOCKED` does not mean success.

`result` and single-job `status` display contract validity and any task status or contract error; listings append `[contract valid]` or `[contract invalid]`. Both commands accept `--json`, which preserves `resultContract` and the resolved model, provider, reasoning effort, sandbox, and approval settings.

Apply the current CLAUDE.md Codex Orchestration continuation rule: stop after a one-off review, but continue already-authorized SDD tasks and bounded fix rounds. Findings do not authorize work outside that scope.

Preserve actionable errors and apply that contract's failure policy. Distinguish result-fetch failure, infrastructure failure, user cancellation, and task-level outcomes before retrieval, retry, or stopping. Never invent a substitute answer or implement a failed rescue task directly. Report invocation stderr and exit status; for missing Codex or authentication, direct the user to `/codex:setup`.
