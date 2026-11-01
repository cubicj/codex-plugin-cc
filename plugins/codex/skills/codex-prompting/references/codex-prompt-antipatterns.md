# Codex Prompt Anti-Patterns

Avoid these when composing Codex worker prompts:

- Vague scope or unrelated jobs: [prompt assembly](../SKILL.md#prompt-assembly).
- Missing response fields: [output contracts](prompt-blocks.md#output-and-format).
- Unresolved completion criteria: [completion and verification](prompt-blocks.md#follow-through-and-completion).
- More reasoning without an evidence check: [verification_loop](prompt-blocks.md#verification_loop).
- Unsupported certainty or missing facts: [grounding and missing context](prompt-blocks.md#grounding-and-missing-context).
