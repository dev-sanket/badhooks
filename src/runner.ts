import {
  evaluateDelivery,
  evaluateRun,
  type DeliveryOutcome,
  type RunStatus,
} from "./assert.js";
import type { LoadedScenario } from "./scenario.js";
import { sign } from "./signer.js";

export type { DeliveryOutcome };

export type RunResult = {
  scenario: string;
  result: RunStatus;
  passed: boolean;
  assertion: string | null;
  deliveries: DeliveryOutcome[];
  diagnosis: string | null;
  manual_check_required: string | null;
  pass_detail: string | null;
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
  verbose?: boolean;
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

    const timestamp =
      Math.floor(deps.now() / 1000) + (delivery.timestamp_offset_s ?? 0);
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
    const responseBody = options.verbose ? await response.text() : undefined;
    const ms = Math.max(0, Math.round(deps.now() - started));

    const outcome: DeliveryOutcome = {
      event: delivery.event,
      id: delivery.id,
      replay,
      status: response.status,
      expected: delivery.expect,
      ok: evaluateDelivery(delivery.expect, response.status),
      ms,
      requestBody: options.verbose ? body : undefined,
      responseBody,
    };

    deliveries.push(outcome);
    deps.onDelivery?.(outcome);
  }

  const result = evaluateRun(scenario.assert, deliveries);

  return {
    scenario: scenario.name,
    result,
    passed: result === "pass",
    assertion: scenario.assert ?? null,
    deliveries,
    diagnosis: scenario.diagnosis ?? null,
    manual_check_required: scenario.manual_check_required ?? null,
    pass_detail: scenario.pass_detail ?? null,
  };
}
