import type { DeliveryExpect, ScenarioAssert } from "./scenario.js";

export type DeliveryOutcome = {
  event: string;
  id: string;
  replay: boolean;
  status: number;
  expected: DeliveryExpect;
  ok: boolean;
  ms: number;
};

export function evaluateDelivery(
  expect: DeliveryExpect,
  status: number,
): boolean {
  if (expect === "accepted") {
    return status >= 200 && status < 300;
  }
  if (expect === "rejected") {
    return status >= 400 && status < 500;
  }
  if (expect === "either") {
    return true;
  }
  return false;
}

export function evaluateOverall(
  assertion: ScenarioAssert | undefined,
  deliveries: readonly DeliveryOutcome[],
): boolean {
  if (assertion === "at_most_one_accepted") {
    const accepted = deliveries.filter(
      (d) => d.status >= 200 && d.status < 300,
    ).length;
    return accepted <= 1;
  }
  return true;
}

export function evaluateRun(
  assertion: ScenarioAssert | undefined,
  deliveries: readonly DeliveryOutcome[],
): boolean {
  return (
    deliveries.every((d) => d.ok) && evaluateOverall(assertion, deliveries)
  );
}
