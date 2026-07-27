import type { DeliveryOutcome, RunResult } from "./runner.js";

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  409: "Conflict",
  422: "Unprocessable Entity",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
};

export type ReportColors = {
  green: (text: string) => string;
  red: (text: string) => string;
  yellow: (text: string) => string;
  dim: (text: string) => string;
};

const identity = (text: string): string => text;

export const plainColors: ReportColors = {
  green: identity,
  red: identity,
  yellow: identity,
  dim: identity,
};

export function ansiColors(): ReportColors {
  return {
    green: (text) => `\u001b[32m${text}\u001b[0m`,
    red: (text) => `\u001b[31m${text}\u001b[0m`,
    yellow: (text) => `\u001b[33m${text}\u001b[0m`,
    dim: (text) => `\u001b[2m${text}\u001b[0m`,
  };
}

export function colorsForTty(isTty: boolean): ReportColors {
  return isTty ? ansiColors() : plainColors;
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function statusLabel(status: number): string {
  const text = STATUS_TEXT[status];
  return text ? `${status} ${text}` : String(status);
}

export function formatDeliveryLine(
  delivery: DeliveryOutcome,
  colors: ReportColors = plainColors,
): string {
  const event = pad(
    delivery.replay ? `${delivery.event}  (replay)` : delivery.event,
    28,
  );
  const id = pad(delivery.id, 22);
  const status = pad(statusLabel(delivery.status), 18);
  const line = `→ ${event}${id}${status}${delivery.ms}ms`;
  return delivery.ok ? line : colors.dim(line);
}

function expectedLine(result: RunResult): string {
  if (result.scenario === "duplicate-charge-succeeded") {
    return "  Expected  the replayed event rejected (409) or acknowledged with no work done";
  }
  if (result.scenario === "refund-before-payment") {
    return "  Expected  refund rejected, then charge accepted";
  }
  if (result.scenario === "charge-and-payment-intent-succeeded") {
    return "  Expected  at most one accepted delivery for the same underlying payment";
  }
  if (result.scenario === "delayed-charge-succeeded") {
    return "  Expected  the late charge.succeeded accepted (2xx)";
  }
  return "  Expected  deliveries to match scenario expectations";
}

function actualLine(result: RunResult): string {
  const acceptedCount = result.deliveries.filter(
    (d) => d.status >= 200 && d.status < 300,
  ).length;

  if (
    result.scenario === "duplicate-charge-succeeded" &&
    acceptedCount > 1
  ) {
    return "  Actual    both deliveries returned 200";
  }

  if (
    result.scenario === "charge-and-payment-intent-succeeded" &&
    acceptedCount > 1
  ) {
    return "  Actual    both events returned 2xx";
  }

  return `  Actual    ${describeActual(result.deliveries)}`;
}

export function formatSummary(
  result: RunResult,
  colors: ReportColors = plainColors,
): string {
  if (result.result === "pass") {
    return [
      colors.green(`✓ PASS  ${result.scenario}`),
      "",
      `  ${result.pass_detail ?? "Scenario expectations met."}`,
    ].join("\n");
  }

  if (result.result === "inconclusive") {
    const duplicate = result.scenario === "duplicate-charge-succeeded";
    return [
      colors.yellow(`? INCONCLUSIVE  ${result.scenario}`),
      "",
      duplicate
        ? "  Both deliveries returned 200. That's valid — Stripe recommends"
        : "  Both deliveries returned 2xx. That's valid — Stripe recommends",
      duplicate
        ? "  acknowledging duplicates rather than rejecting them."
        : "  acknowledging webhook events even when no work is performed.",
      "",
      "  badhooks can't see whether work happened twice.",
      `  ${result.manual_check_required ?? "Check your database to confirm whether work happened once or twice."}`,
      "",
      duplicate
        ? "  (A 409 on the replay would let badhooks confirm this automatically.)"
        : "  (A 4xx on one delivery would let badhooks confirm this automatically.)",
    ].join("\n");
  }

  const lines = [
    colors.red(`✗ FAIL  ${result.scenario}`),
    "",
    expectedLine(result),
    actualLine(result),
    "",
    `  ${result.diagnosis ?? "Scenario expectations were not met."}`,
  ];

  if (result.manual_check_required) {
    lines.push(`  ${result.manual_check_required}`);
  }

  return lines.join("\n");
}

export function formatVerboseDelivery(delivery: DeliveryOutcome): string {
  return [
    "  Request body:",
    indent(delivery.requestBody ?? ""),
    "  Response body:",
    indent(delivery.responseBody ?? ""),
  ].join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function describeActual(deliveries: readonly DeliveryOutcome[]): string {
  return deliveries
    .map((d) => `${d.event}${d.replay ? "(replay)" : ""}=${d.status}`)
    .join(", ");
}

export function formatRunReport(
  result: RunResult,
  colors: ReportColors = plainColors,
): string {
  const deliveryLines = result.deliveries.map((d) =>
    formatDeliveryLine(d, colors),
  );
  return [...deliveryLines, "", formatSummary(result, colors)].join("\n");
}
