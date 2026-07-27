import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { loadScenario } from "../src/scenario.js";
import { runScenario } from "../src/runner.js";

describe("runScenario", () => {
  it("signs and posts the exact fixture body with delays and replay metadata", async () => {
    const scenario = await loadScenario("duplicate-charge-succeeded");
    const secret = "whsec_test_secret";
    const requests: Array<{
      url: string;
      body: string;
      headers: Headers;
    }> = [];
    const sleeps: number[] = [];
    const live: Array<{ replay: boolean; status: number }> = [];
    let clock = 1_700_000_000_000;

    const result = await runScenario(
      scenario,
      { target: "http://example.test/webhooks/stripe", secret },
      {
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        },
        fetch: async (input, init) => {
          const body = String(init?.body ?? "");
          const headers = new Headers(init?.headers);
          requests.push({
            url: String(input),
            body,
            headers,
          });
          clock += 12;
          const status = requests.length === 1 ? 200 : 409;
          return new Response("{}", { status });
        },
        onDelivery: (delivery) => {
          live.push({ replay: delivery.replay, status: delivery.status });
        },
      },
    );

    assert.equal(sleeps.length, 1);
    assert.equal(sleeps[0], 3000);
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.body, scenario.bodies["charge.succeeded"]);
    assert.equal(requests[1]?.body, requests[0]?.body);
    assert.equal(requests[0]?.headers.get("Content-Type"), "application/json");

    const body = requests[0]!.body;
    const timestamp = Math.floor(1_700_000_000_000 / 1000);
    const expectedV1 = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`, "utf8")
      .digest("hex");
    assert.equal(
      requests[0]?.headers.get("Stripe-Signature"),
      `t=${timestamp},v1=${expectedV1}`,
    );

    assert.deepEqual(live, [
      { replay: false, status: 200 },
      { replay: true, status: 409 },
    ]);
    assert.equal(result.passed, true);
    assert.equal(result.result, "pass");
    assert.equal(result.deliveries[0]?.ok, true);
    assert.equal(result.deliveries[1]?.ok, true);
    assert.equal(result.deliveries[0]?.ms, 12);
  });

  it("is inconclusive when duplicate deliveries are both accepted", async () => {
    const scenario = await loadScenario("duplicate-charge-succeeded");
    const result = await runScenario(
      scenario,
      {
        target: "http://example.test/webhooks/stripe",
        secret: "whsec_test_secret",
      },
      {
        now: () => 1_700_000_000_000,
        sleep: async () => {},
        fetch: async () => new Response("{}", { status: 200 }),
      },
    );

    assert.equal(result.passed, false);
    assert.equal(result.result, "inconclusive");
    assert.equal(result.deliveries[1]?.ok, false);
    assert.equal(result.deliveries[1]?.replay, true);
  });

  it("signs delayed-charge-succeeded 90 seconds in the past", async () => {
    const scenario = await loadScenario("delayed-charge-succeeded");
    const secret = "whsec_test_secret";
    const nowMs = 1_700_000_090_000;
    let signedHeader = "";

    const result = await runScenario(
      scenario,
      { target: "http://example.test/webhooks/stripe", secret },
      {
        now: () => nowMs,
        sleep: async () => {},
        fetch: async (_input, init) => {
          signedHeader = new Headers(init?.headers).get("Stripe-Signature") ?? "";
          return new Response("{}", { status: 200 });
        },
      },
    );

    const timestamp = Math.floor(nowMs / 1000) - 90;
    const body = scenario.bodies["charge.succeeded"]!;
    const expectedV1 = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`, "utf8")
      .digest("hex");
    assert.equal(signedHeader, `t=${timestamp},v1=${expectedV1}`);
    assert.equal(result.passed, true);
    assert.equal(result.result, "pass");
  });

  it("runs refund-before-payment with distinct event ids", async () => {
    const scenario = await loadScenario("refund-before-payment");
    const statuses = [409, 200];
    let i = 0;
    const result = await runScenario(
      scenario,
      {
        target: "http://example.test/webhooks/stripe",
        secret: "whsec_test_secret",
      },
      {
        now: () => 1_700_000_000_000,
        sleep: async () => {},
        fetch: async () => new Response("{}", { status: statuses[i++]! }),
      },
    );

    assert.equal(result.passed, true);
    assert.equal(result.result, "pass");
    assert.equal(result.deliveries[0]?.replay, false);
    assert.equal(result.deliveries[1]?.replay, false);
    assert.equal(result.deliveries[0]?.id, "evt_9f8e7d");
    assert.equal(result.deliveries[1]?.id, "evt_4c5d6e");
  });

  it("is inconclusive when charge and payment intent are both accepted", async () => {
    const scenario = await loadScenario("charge-and-payment-intent-succeeded");
    const result = await runScenario(
      scenario,
      {
        target: "http://example.test/webhooks/stripe",
        secret: "whsec_test_secret",
      },
      {
        now: () => 1_700_000_000_000,
        sleep: async () => {},
        fetch: async () => new Response("{}", { status: 200 }),
      },
    );

    assert.equal(result.passed, false);
    assert.equal(result.result, "inconclusive");
    assert.equal(result.deliveries[0]?.replay, false);
    assert.equal(result.deliveries[1]?.replay, false);
    assert.equal(result.assertion, "at_most_one_accepted");
  });
});
