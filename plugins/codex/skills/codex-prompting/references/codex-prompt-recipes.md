# Codex Prompt Recipes

These are task-body fragments for Codex workers, not complete dispatch prompts. Prepend the [Worker Envelope](prompt-blocks.md#worker-envelope) to every fresh or resumed dispatch and retain its language contract when trimming. Follow the [assembly checklist](../SKILL.md#prompt-assembly), including `missing_context_gating` from [Prompt Blocks](prompt-blocks.md#missing_context_gating). Supply the actual paths, inputs, scope, and acceptance checks before dispatch.

## Diagnosis

```xml
<task>
Diagnose the supplied failing test or command in this repository.
Identify the root cause from repository context and tool evidence.
</task>

<compact_output_contract>
Return:
1. most likely root cause
2. evidence
3. smallest safe next step
4. unresolved uncertainty
</compact_output_contract>

<verification_loop>
Verify that the proposed root cause explains the observed failure.
</verification_loop>
```

## Narrow Fix

```xml
<task>
Implement the smallest fix for the identified issue.
Preserve behavior outside the failing path.
</task>

<structured_output_contract>
Return:
1. fix summary and touched files
2. validation commands and results
3. remaining risks and unverified behavior
</structured_output_contract>

<completeness_contract>
Complete the fix and its required validation before reporting.
</completeness_contract>

<action_safety>
Keep changes within the stated scope; avoid unrelated refactors or cleanup.
</action_safety>
```

## Root-Cause Review

```xml
<task>
Review the supplied change for material correctness and regression issues.
Use the stated repository and diff boundaries.
</task>

<structured_output_contract>
Return findings ordered by severity, each with file and line evidence and the failing scenario.
If no findings remain, say so and identify the validation limits.
</structured_output_contract>

<grounding_rules>
Distinguish observed defects from hypotheses and verify each finding against the code.
</grounding_rules>

<dig_deeper_nudge>
Inspect relevant empty states, retries, stale state, cleanup, and rollback paths.
</dig_deeper_nudge>
```

## Research Or Recommendation

```xml
<task>
Research the available options and recommend a path for the stated requirements.
</task>

<structured_output_contract>
Return:
1. observed facts and sources
2. recommendation and supporting reasoning
3. tradeoffs and unresolved questions
</structured_output_contract>

<citation_rules>
Cite the sources inspected for important claims; prefer primary sources.
</citation_rules>
```

## Prompt-Patching

```xml
<task>
Diagnose the supplied prompt failures and propose the smallest changes supported by those examples.
</task>

<structured_output_contract>
Return:
1. evidenced failure modes and their causes
2. one revised prompt
3. how the revision addresses those failures
</structured_output_contract>

<verification_loop>
Check the revised prompt against the failure examples and remove contradictory instructions.
</verification_loop>
```
