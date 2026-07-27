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
  dim: (text: string) => string;
};

const identity = (text: string): string => text;

export const plainColors: ReportColors = {
  green: identity,
  red: identity,
  dim: identity,
};

export function ansiColors(): ReportColors {
  return {
    green: (text) => `\u001b[32m${text}\u001b[0m`,
    red: (text) => `\u001b[31m${text}\u001b[0m`,
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

export function formatSummary(
  result: RunResult,
  colors: ReportColors = plainColors,
): string {
  if (result.passed) {
    return [
      colors.green(`✓ PASS  ${result.scenario}`),
      "",
      "  Endpoint rejected the replayed event.",
    ].join("\n");
  }

  const acceptedCount = result.deliveries.filter(
    (d) => d.status >= 200 && d.status < 300,
  ).length;

  const lines = [
    colors.red(`✗ FAIL  ${result.scenario}`),
    "",
    "  Expected  the replayed event rejected (409) or acknowledged with no work done",
    `  Actual    ${
      acceptedCount > 1
        ? "both deliveries returned 200"
        : describeActual(result.deliveries)
    }`,
    "",
    "  Your handler is not deduplicating on event ID.",
    "  Check your database — if there are now two payment rows, this is the bug.",
  ];

  return lines.join("\n");
}

function describeActual(deliveries: readonly DeliveryOutcome[]): string {
  return deliveries
    .map((d) => `${d.replay ? "replay" : "first"}=${d.status}`)
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
