import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateDelivery,
  evaluateOverall,
  evaluateRun,
  type DeliveryOutcome,
} from "../src/assert.js";

function outcome(
  partial: Partial<DeliveryOutcome> & Pick<DeliveryOutcome, "status" | "ok">,
): DeliveryOutcome {
  return {
    event: "charge.succeeded",
    id: "evt_1a2b3c",
    replay: false,
    expected: "accepted",
    ms: 1,
    ...partial,
  };
}

describe("evaluateDelivery", () => {
  it("accepts 2xx for accepted", () => {
    assert.equal(evaluateDelivery("accepted", 200), true);
    assert.equal(evaluateDelivery("accepted", 204), true);
    assert.equal(evaluateDelivery("accepted", 409), false);
  });

  it("accepts any 4xx for rejected", () => {
    assert.equal(evaluateDelivery("rejected", 409), true);
    assert.equal(evaluateDelivery("rejected", 400), true);
    assert.equal(evaluateDelivery("rejected", 200), false);
    assert.equal(evaluateDelivery("rejected", 500), false);
  });

  it("passes either regardless of status", () => {
    assert.equal(evaluateDelivery("either", 200), true);
    assert.equal(evaluateDelivery("either", 500), true);
  });
});

describe("evaluateOverall", () => {
  it("enforces at_most_one_accepted", () => {
    assert.equal(
      evaluateOverall("at_most_one_accepted", [
        outcome({ status: 200, ok: true }),
        outcome({ status: 409, ok: true, replay: true, expected: "rejected" }),
      ]),
      true,
    );
    assert.equal(
      evaluateOverall("at_most_one_accepted", [
        outcome({ status: 200, ok: true }),
        outcome({ status: 200, ok: false, replay: true, expected: "rejected" }),
      ]),
      false,
    );
  });

  it("passes when no overall assertion is set", () => {
    assert.equal(
      evaluateOverall(undefined, [
        outcome({ status: 200, ok: true }),
        outcome({ status: 200, ok: true }),
      ]),
      true,
    );
  });
});

describe("evaluateRun", () => {
  it("passes when every delivery and the overall assertion pass", () => {
    assert.equal(
      evaluateRun("at_most_one_accepted", [
        outcome({ status: 200, ok: true }),
        outcome({ status: 409, ok: true, replay: true, expected: "rejected" }),
      ]),
      "pass",
    );
  });

  it("is inconclusive when all accepted responses could have been no-ops", () => {
    assert.equal(
      evaluateRun("at_most_one_accepted", [
        outcome({ status: 200, ok: true }),
        outcome({ status: 200, ok: false, replay: true, expected: "rejected" }),
      ]),
      "inconclusive",
    );
  });

  it("fails when HTTP responses prove a delivery expectation was missed", () => {
    assert.equal(
      evaluateRun("at_most_one_accepted", [
        outcome({ status: 409, ok: false }),
        outcome({ status: 200, ok: true, replay: true, expected: "rejected" }),
      ]),
      "fail",
    );
  });
});
