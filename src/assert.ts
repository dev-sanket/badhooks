import type { DeliveryExpect, ScenarioAssert } from "./scenario.js";

export type DeliveryOutcome = {
  event: string;
  id: string;
  replay: boolean;
  status: number;
  expected: DeliveryExpect;
  ok: boolean;
  ms: number;
  requestBody?: string;
  responseBody?: string;
};

export type RunStatus = "pass" | "fail" | "inconclusive";

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
): RunStatus {
  if (
    deliveries.every((delivery) => delivery.ok) &&
    evaluateOverall(assertion, deliveries)
  ) {
    return "pass";
  }

  const onlyAmbiguousFailures =
    assertion === "at_most_one_accepted" &&
    deliveries.every(
      (delivery) =>
        delivery.ok ||
        (delivery.expected === "rejected" &&
          delivery.status >= 200 &&
          delivery.status < 300),
    );

  return onlyAmbiguousFailures ? "inconclusive" : "fail";
}
