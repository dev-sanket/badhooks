import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { join } from "node:path";
import { loadScenario, packageRoot } from "../src/scenario.js";

describe("loadScenario", () => {
  it("loads duplicate-charge-succeeded with an exact fixture body", async () => {
    const root = packageRoot();
    const scenario = await loadScenario("duplicate-charge-succeeded", root);
    const fixturePath = join(root, "fixtures", "charge.succeeded.json");
    const rawFixture = await readFile(fixturePath, "utf8");

    assert.equal(scenario.name, "duplicate-charge-succeeded");
    assert.equal(scenario.assert, "at_most_one_accepted");
    assert.equal(scenario.deliveries.length, 2);
    assert.equal(scenario.deliveries[0]?.id, "evt_1a2b3c");
    assert.equal(scenario.deliveries[1]?.delay_ms, 3000);
    assert.equal(scenario.bodies["charge.succeeded"], rawFixture);
    assert.match(rawFixture, /"id": "evt_1a2b3c"/);
  });

  it("loads refund-before-payment with linked charge fixtures", async () => {
    const scenario = await loadScenario("refund-before-payment");
    assert.equal(scenario.deliveries[0]?.event, "charge.refunded");
    assert.equal(scenario.deliveries[0]?.expect, "rejected");
    assert.equal(scenario.deliveries[1]?.event, "charge.succeeded");
    assert.equal(scenario.deliveries[1]?.expect, "accepted");
    assert.match(scenario.bodies["charge.refunded"]!, /"id": "evt_9f8e7d"/);
    assert.match(scenario.bodies["charge.refunded"]!, /"id": "ch_4c5d6e"/);
    assert.match(scenario.bodies["charge.succeeded"]!, /"id": "evt_4c5d6e"/);
    assert.match(scenario.bodies["charge.succeeded"]!, /"id": "ch_4c5d6e"/);
  });

  it("loads charge-and-payment-intent-succeeded with shared payment refs", async () => {
    const scenario = await loadScenario("charge-and-payment-intent-succeeded");
    assert.equal(scenario.assert, "at_most_one_accepted");
    assert.equal(scenario.deliveries[0]?.id, "evt_pi_7a8b9c");
    assert.equal(scenario.deliveries[1]?.id, "evt_ch_7a8b9c");
    assert.equal(scenario.deliveries[1]?.delay_ms, 1000);
    assert.match(scenario.bodies["payment_intent.succeeded"]!, /"id": "pi_7a8b9c"/);
    assert.match(scenario.bodies["charge.succeeded"]!, /"payment_intent": "pi_7a8b9c"/);
    assert.match(scenario.bodies["payment_intent.succeeded"]!, /"order_id": "ord_7a8b9c"/);
    assert.match(scenario.bodies["charge.succeeded"]!, /"order_id": "ord_7a8b9c"/);
  });

  it("loads delayed-charge-succeeded with a -90s signature offset", async () => {
    const scenario = await loadScenario("delayed-charge-succeeded");
    assert.equal(scenario.deliveries.length, 1);
    assert.equal(scenario.deliveries[0]?.expect, "accepted");
    assert.equal(scenario.deliveries[0]?.timestamp_offset_s, -90);
    assert.match(scenario.bodies["charge.succeeded"]!, /"id": "evt_late_90s"/);
  });

  it("errors on unknown scenarios", async () => {
    await assert.rejects(
      () => loadScenario("does-not-exist"),
      /Unknown scenario: does-not-exist/,
    );
  });
});
