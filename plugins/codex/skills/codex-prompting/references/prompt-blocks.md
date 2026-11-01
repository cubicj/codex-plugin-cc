# Prompt Blocks

Use these blocks selectively when composing Codex prompts.
Wrap each block in the XML tag shown in its heading.

## Worker Envelope

### `language_contract`

Use at the start of every controller-dispatched worker prompt.

```text
[Claude-Orchestrated Task]
<language_contract>
Use Korean for live in-session communication: status updates, progress narration, and any questions.
Use English for controller-consumed output: the final response and any report files.
</language_contract>
```

## Core Wrapper

### `task`

Use in nearly every prompt.

```xml
<task>
Describe the concrete job, the relevant repository or failure context, and the expected end state.
</task>
```

## Output and Format

### `structured_output_contract`

Before dispatch, write the exact required sections or JSON fields, their order, and any report path inside `structured_output_contract`. For schema-bound output, also pass `--output-schema <file>` as a runtime control. The task-body recipes contain concrete section lists to adapt.

### `compact_output_contract`

Use when you want concise prose instead of a schema.

```xml
<compact_output_contract>
Keep the final answer compact and structured.
Do not include long scene-setting or repeated recap.
</compact_output_contract>
```

## Follow-through and Completion

### `default_follow_through_policy`

Use for a task-specific follow-through default; missing facts and uncertainty belong to `missing_context_gating`.

```xml
<default_follow_through_policy>
Default to the most reasonable low-risk interpretation and keep going.
</default_follow_through_policy>
```

### `completeness_contract`

Use for debugging, implementation, or any multi-step task that should not stop early.

```xml
<completeness_contract>
Resolve the task fully before stopping.
Do not stop at the first plausible answer.
Check whether there are follow-on fixes, edge cases, or cleanup needed for a correct result.
</completeness_contract>
```

### `verification_loop`

Use when correctness matters.

```xml
<verification_loop>
Before finalizing, verify the result against the task requirements and the changed files or tool outputs.
If a check fails, revise the answer instead of reporting the first draft.
</verification_loop>
```

## Grounding and Missing Context

### `missing_context_gating`

Use when Codex might otherwise guess.

```xml
<missing_context_gating>
Do not ask questions.
Retrieve missing repository facts with tools when possible.
When uncertainty remains, state a bounded assumption and proceed, or record the blocker in the final report without taking an unsafe action.
Abort only when ambiguity would make an irreversible or destructive action unsafe.
</missing_context_gating>
```

### `grounding_rules`

Use for review, research, or root-cause analysis.

```xml
<grounding_rules>
Ground every claim in the provided context or your tool outputs.
Do not present inferences as facts.
If a point is a hypothesis, label it clearly.
</grounding_rules>
```

### `citation_rules`

Use when external research or quotes matter.

```xml
<citation_rules>
Back important claims with citations or explicit references to the source material you inspected.
Prefer primary sources.
</citation_rules>
```

## Safety and Scope

### `action_safety`

Use for write-capable or potentially broad tasks.

```xml
<action_safety>
Keep changes tightly scoped to the stated task.
Avoid unrelated refactors, renames, or cleanup unless they are required for correctness.
Call out any risky or irreversible action before taking it.
</action_safety>
```

## Task-Specific Blocks

### `research_mode`

Use for exploration, comparisons, or recommendations.

```xml
<research_mode>
Separate observed facts, reasoned inferences, and open questions.
Prefer breadth first, then go deeper only where the evidence changes the recommendation.
</research_mode>
```

### `dig_deeper_nudge`

Use for review and adversarial inspection.

```xml
<dig_deeper_nudge>
After you find the first plausible issue, check for second-order failures, empty-state behavior, retries, stale state, and rollback paths before you finalize.
</dig_deeper_nudge>
```

### `progress_updates`

Use when the run may take a while.

```xml
<progress_updates>
If you provide progress updates, keep them brief and outcome-based.
Mention only major phase changes or blockers.
</progress_updates>
```
