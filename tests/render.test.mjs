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
test("renderJobStatusReport shows resolved settings and the resume command", () => {
  const output = renderJobStatusReport({ ...JOB, resolved: SETTINGS });
  assert.ok(output.includes(SETTINGS_LINE));
  assert.match(output, /Codex session ID: thr_123/);
  assert.match(output, /codex resume thr_123/);
});

test("renderJobStatusReport renders string policies and reasoning effort without a thread", () => {
  const output = renderJobStatusReport({
    id: "task-123",
    status: "queued",
    resolved: { model: "", reasoningEffort: "medium", sandbox: "readOnly", approvalPolicy: "never" }
  });
  assert.match(output, /Settings: effort medium, sandbox readOnly, approval never/);
  assert.doesNotMatch(output, /Codex session ID:|codex resume/);
});

test("renderJobStatusReport preserves output without displayable resolved settings", () => {
  const baseline = renderJobStatusReport(JOB);
  for (const resolved of [undefined, null, [], "invalid", new Date(), {}, { modelProvider: "openai" },
    { model: "", reasoningEffort: null, sandbox: {}, approvalPolicy: {} }]) {
    assert.equal(renderJobStatusReport({ ...JOB, resolved }), baseline);
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
    function assertPayload(output) {
      if (label === "fallback") {
        assert.match(output, /Job: task-123/);
        assert.match(output, /Status: completed/);
        assert.match(output, /No captured result payload was stored for this job\./);
      } else {
        assert.match(output, /^Answer\n/);
        assert.equal(output.replace(/^(?:Codex session ID:|Resume in Codex:|Settings:).*$/gm, "").trim(), "Answer");
      }
      if (threadId) {
        assert.match(output, /Codex session ID: thr_123/);
        assert.match(output, /codex resume thr_123/);
      } else {
        assert.doesNotMatch(output, /Codex session ID:|codex resume/);
      }
    }

    test(`renderStoredJobResult preserves ${label} output ${threadId ? "with" : "without"} a thread`, () => {
      const output = renderStoredJobResult(job, storedJob);
      assertPayload(output);
      assert.doesNotMatch(output, /Settings:/);
      if (label !== "fallback" && !threadId) {
        assert.equal(output, "Answer\n");
      }
    });

    test(`renderStoredJobResult shows settings for ${label} ${threadId ? "with" : "without"} a thread`, () => {
      for (const output of [
        renderStoredJobResult({ ...job, resolved: SETTINGS }, storedJob),
        renderStoredJobResult(
          { ...job, resolved: { model: "ignored" } },
          { ...storedJob, resolved: SETTINGS }
        ),
        renderStoredJobResult(
          { ...job, resolved: SETTINGS },
          { ...storedJob, resolved: null }
        )
      ]) {
        assertPayload(output);
        assert.ok(output.includes(SETTINGS_LINE));
        assert.doesNotMatch(output, /model ignored/);
      }
    });
  }
}
