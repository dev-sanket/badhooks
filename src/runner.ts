import {
  evaluateDelivery,
  evaluateRun,
  type DeliveryOutcome,
} from "./assert.js";
import type { LoadedScenario } from "./scenario.js";
import { sign } from "./signer.js";

export type { DeliveryOutcome };

export type RunResult = {
  scenario: string;
  passed: boolean;
  assertion: string | null;
  deliveries: DeliveryOutcome[];
};

export type RunnerDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Epoch milliseconds. Used for signature timestamps and latency. */
  now: () => number;
  onDelivery?: (result: DeliveryOutcome) => void;
};

export type RunOptions = {
  target: string;
  secret: string;
};

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export function defaultRunnerDeps(
  overrides: Partial<RunnerDeps> = {},
): RunnerDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    sleep: defaultSleep,
    now: () => Date.now(),
    ...overrides,
  };
}

export async function runScenario(
  scenario: LoadedScenario,
  options: RunOptions,
  deps: RunnerDeps = defaultRunnerDeps(),
): Promise<RunResult> {
  const seenIds = new Set<string>();
  const deliveries: DeliveryOutcome[] = [];

  for (const delivery of scenario.deliveries) {
    if (delivery.delay_ms > 0) {
      await deps.sleep(delivery.delay_ms);
    }

    const body = scenario.bodies[delivery.event];
    if (body === undefined) {
      throw new Error(
        `No fixture body loaded for event type ${delivery.event}`,
      );
    }

    const timestamp = Math.floor(deps.now() / 1000);
    const { header } = sign(body, options.secret, timestamp);
    const replay = seenIds.has(delivery.id);
    seenIds.add(delivery.id);

    const started = deps.now();
    const response = await deps.fetch(options.target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Stripe-Signature": header,
      },
      body,
    });
    const ms = Math.max(0, Math.round(deps.now() - started));

    const outcome: DeliveryOutcome = {
      event: delivery.event,
      id: delivery.id,
      replay,
      status: response.status,
      expected: delivery.expect,
      ok: evaluateDelivery(delivery.expect, response.status),
      ms,
    };

    deliveries.push(outcome);
    deps.onDelivery?.(outcome);
  }

  return {
    scenario: scenario.name,
    passed: evaluateRun(scenario.assert, deliveries),
    assertion: scenario.assert ?? null,
    deliveries,
  };
}
