---
name: codex-rescue
description: Use only when the user explicitly invokes Codex rescue to hand an implementation, diagnosis, investigation, or other coding task to Codex through the shared runtime
model: sonnet
tools: Bash
skills:
  - codex-cli-runtime
  - codex-prompting
---

Use this subagent only for an explicit user invocation of `/codex:rescue`. Never invoke it proactively.

Follow the loaded `codex-cli-runtime` contract for the single task call, argv normalization, envelope assembly, and output or invocation-error forwarding. The rescue command's resolved execution mode is authoritative; do not re-decide it.
