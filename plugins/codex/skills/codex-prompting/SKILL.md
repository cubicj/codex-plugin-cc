---
name: codex-prompting
description: Internal guidance for composing Codex prompts for coding, review, diagnosis, and research tasks inside the Codex Claude Code plugin
user-invocable: false
---

# Codex Prompting

Use this skill in the Claude controller before composing a Codex worker prompt; the explicitly invoked rescue agent also uses its worker envelope.

Follow the current session's CLAUDE.md Codex Orchestration contract for invocation, titles, resume, watchers, result retrieval, continuation, and retry; keep runtime flags outside the worker prompt.

## Prompt assembly

1. Prepend the [Worker Envelope](references/prompt-blocks.md#worker-envelope) to every fresh or resumed dispatch. Keep its marker on the first line and retain its language contract when tightening the prompt.
2. Define one concrete task in `<task>`: repository and file paths, relevant context, scope boundaries, and the expected end state. For a review, specify the changes to inspect and the evidence required for findings.
3. Specify the exact output sections or JSON fields, their order, and any report path in `<structured_output_contract>`; use `<compact_output_contract>` for concise prose. For schema-bound output, supply the schema through the runtime control as well.
4. Include `missing_context_gating` from the block reference for missing facts and uncertainty. Add task-specific stop conditions only when an unsafe action requires them.
5. For implementation or diagnosis, add `completeness_contract` and `verification_loop` with concrete acceptance checks. For review or research, add `grounding_rules` and any needed `citation_rules`. For writes, add `action_safety` with the authorized file and behavior boundaries.
6. Use the reference's XML tag names consistently. Include brief progress updates for long runs. Remove repeated instructions while preserving the envelope, scope, evidence requirements, and completion criteria.

[Reusable blocks](references/prompt-blocks.md) own the envelope and shared contracts. [Task-body recipes](references/codex-prompt-recipes.md) provide fragments to assemble beneath it. [Anti-patterns](references/codex-prompt-antipatterns.md) index common omissions.
