import test from "node:test";
import assert from "node:assert/strict";

import { renderJobStatusReport, renderReviewResult, renderStatusReport, renderStoredJobResult } from "../plugins/codex/scripts/lib/render.mjs";

test("renderReviewResult degrades gracefully when JSON is missing required review fields", () => {
  const output = renderReviewResult(
    {
      parsed: {
        verdict: "approve",
        summary: "Looks fine."
      },
      rawOutput: JSON.stringify({
        verdict: "approve",
        summary: "Looks fine."
      }),
      parseError: null
    },
    {
      reviewLabel: "Adversarial Review",
      targetLabel: "working tree diff"
    }
  );

  assert.match(output, /Codex returned JSON with an unexpected review shape\./);
  assert.match(output, /Missing array `findings`\./);
  assert.match(output, /Raw final message:/);
});

test("renderStoredJobResult prefers rendered output for structured review jobs", () => {
  const output = renderStoredJobResult(
    {
      id: "review-123",
      status: "completed",
      title: "Codex Adversarial Review",
      jobClass: "review",
      threadId: "thr_123"
    },
    {
      threadId: "thr_123",
      rendered: "# Codex Adversarial Review\n\nTarget: working tree diff\nVerdict: needs-attention\n",
      result: {
        result: {
          verdict: "needs-attention",
          summary: "One issue.",
          findings: [],
          next_steps: []
        },
        rawOutput:
          '{"verdict":"needs-attention","summary":"One issue.","findings":[],"next_steps":[]}'
      }
    }
  );

  assert.match(output, /^# Codex Adversarial Review/);
  assert.doesNotMatch(output, /^\{/);
  assert.match(output, /Codex session ID: thr_123/);
  assert.match(output, /Resume in Codex: codex resume thr_123/);
});

const SETTINGS = {
  model: "gpt-5.4",
  modelProvider: "openai",
  reasoningEffort: null,
  sandbox: { type: "workspaceWrite" },
  approvalPolicy: { granular: { sandbox_approval: true } }
};
const SETTINGS_LINE = "Settings: model gpt-5.4, sandbox workspaceWrite, approval granular";
const JOB = { id: "task-123", status: "completed", threadId: "thr_123" };
const SESSION_LINES = "Codex session ID: thr_123\nResume in Codex: codex resume thr_123\n";
const STATUS_OUTPUT = "# Codex Job Status\n\n- task-123 | completed\n  Codex session ID: thr_123\n  Resume in Codex: codex resume thr_123\n  Result: /codex:result task-123\n";

test("renderJobStatusReport shows resolved settings after the resume command", () => {
  assert.equal(
    renderJobStatusReport({ ...JOB, resolved: SETTINGS }),
    STATUS_OUTPUT.replace("  Result:", `  ${SETTINGS_LINE}\n  Result:`)
  );
});

test("renderJobStatusReport renders string policies and reasoning effort without a thread", () => {
  assert.equal(
    renderJobStatusReport({
      id: "task-123",
      status: "queued",
      resolved: { model: "", reasoningEffort: "medium", sandbox: "readOnly", approvalPolicy: "never" }
    }),
    "# Codex Job Status\n\n- task-123 | queued\n  Settings: effort medium, sandbox readOnly, approval never\n  Cancel: /codex:cancel task-123\n"
  );
});

test("renderJobStatusReport preserves output without displayable resolved settings", () => {
  for (const resolved of [undefined, null, [], "invalid", new Date(), {}, { modelProvider: "openai" },
    { model: "", reasoningEffort: null, sandbox: {}, approvalPolicy: {} }]) {
    assert.equal(renderJobStatusReport({ ...JOB, resolved }), STATUS_OUTPUT);
  }
});

test("renderStatusReport includes resolved settings in every details section", () => {
  const job = { ...JOB, resolved: SETTINGS };
  const output = renderStatusReport({
    sessionRuntime: { label: "direct" },
    config: {},
    running: [{ ...job, status: "running" }],
    latestFinished: job,
    recent: [job]
  });
  assert.equal(output.split(`  ${SETTINGS_LINE}\n`).length - 1, 3);
  assert.equal(
    output.split("\n").find((line) => line.startsWith("| Job |")),
    "| Job | Kind | Status | Phase | Elapsed | Codex Session ID | Summary | Actions |"
  );
});

for (const [label, storedJob] of [
  ["structured review", { rendered: "Answer\n", result: { result: {}, rawOutput: "Ignored" } }],
  ["raw output", { result: { rawOutput: "Answer" } }],
  ["native stdout", { result: { codex: { stdout: "Answer\n" } } }],
  ["rendered output", { rendered: "Answer" }],
  ["fallback", {}]
]) {
  for (const threadId of ["thr_123", null]) {
    const job = { ...JOB, threadId };
    const session = threadId ? SESSION_LINES : "";
    const fallback = "# Codex Result\n\nJob: task-123\nStatus: completed\n";
    const missing = "\nNo captured result payload was stored for this job.\n";
    const expected = label === "fallback"
      ? `${fallback}${session}${missing}`
      : `Answer\n${session ? `\n${session}` : ""}`;
    const withSettings = label === "fallback"
      ? `${fallback}${session}${SETTINGS_LINE}\n${missing}`
      : `Answer\n\n${session}${SETTINGS_LINE}\n`;

    test(`renderStoredJobResult preserves ${label} output ${threadId ? "with" : "without"} a thread`, () => {
      assert.equal(renderStoredJobResult(job, storedJob), expected);
    });

    test(`renderStoredJobResult shows settings for ${label} ${threadId ? "with" : "without"} a thread`, () => {
      assert.equal(renderStoredJobResult({ ...job, resolved: SETTINGS }, storedJob), withSettings);
      assert.equal(renderStoredJobResult(
        { ...job, resolved: { model: "ignored" } },
        { ...storedJob, resolved: SETTINGS }
      ), withSettings);
      assert.equal(renderStoredJobResult(
        { ...job, resolved: SETTINGS },
        { ...storedJob, resolved: null }
      ), withSettings);
    });
  }
}
