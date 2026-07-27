import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DeliveryOutcome, RunResult } from "../src/runner.js";
import {
  formatDeliveryLine,
  formatRunReport,
  formatSummary,
  plainColors,
} from "../src/report.js";

const first: DeliveryOutcome = {
  event: "charge.succeeded",
  id: "evt_1a2b3c",
  replay: false,
  status: 200,
  expected: "accepted",
  ok: true,
  ms: 42,
};

const replayAccepted: DeliveryOutcome = {
  event: "charge.succeeded",
  id: "evt_1a2b3c",
  replay: true,
  status: 200,
  expected: "rejected",
  ok: false,
  ms: 38,
};

const replayRejected: DeliveryOutcome = {
  ...replayAccepted,
  status: 409,
  ok: true,
  ms: 31,
};

describe("report", () => {
  it("formats delivery lines with replay marker", () => {
    assert.match(
      formatDeliveryLine(first, plainColors),
      /→ charge\.succeeded\s+evt_1a2b3c\s+200 OK\s+42ms/,
    );
    assert.match(
      formatDeliveryLine(replayAccepted, plainColors),
      /→ charge\.succeeded\s+\(replay\)\s+evt_1a2b3c\s+200 OK\s+38ms/,
    );
  });

  it("formats FAIL summary with observable-only wording", () => {
    const result: RunResult = {
      scenario: "duplicate-charge-succeeded",
      passed: false,
      assertion: "at_most_one_accepted",
      deliveries: [first, replayAccepted],
    };
    const summary = formatSummary(result, plainColors);
    assert.match(summary, /✗ FAIL {2}duplicate-charge-succeeded/);
    assert.match(summary, /Expected {2}the replayed event rejected/);
    assert.match(summary, /Actual {4}both deliveries returned 200/);
    assert.match(summary, /not deduplicating on event ID/);
    assert.match(summary, /Check your database/);
    assert.doesNotMatch(summary, /you created two rows/);
  });

  it("formats PASS summary", () => {
    const result: RunResult = {
      scenario: "duplicate-charge-succeeded",
      passed: true,
      assertion: "at_most_one_accepted",
      deliveries: [first, replayRejected],
    };
    const report = formatRunReport(result, plainColors);
    assert.match(report, /✓ PASS {2}duplicate-charge-succeeded/);
    assert.match(report, /Endpoint rejected the replayed event/);
  });
});
