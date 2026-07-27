#!/usr/bin/env node
import {
  listScenarios,
  loadScenario,
  type ScenarioDefinition,
} from "./scenario.js";
import {
  colorsForTty,
  formatDeliveryLine,
  formatSummary,
  formatVerboseDelivery,
} from "./report.js";
import {
  defaultRunnerDeps,
  runScenario,
  type RunResult,
  type RunnerDeps,
} from "./runner.js";

export type CliIo = {
  stdout: { write: (chunk: string) => void; isTTY?: boolean };
  stderr: { write: (chunk: string) => void };
  env: NodeJS.ProcessEnv;
  exit: (code: number) => void;
};

export type MainOptions = {
  io?: CliIo;
  runnerDeps?: Partial<RunnerDeps>;
};

const usage = `Usage:
  badhooks list
  badhooks describe <scenario>
  badhooks run <scenario> --target <url> [--secret whsec_…] [--verbose]

Exit codes: 0 pass, 1 fail, 2 usage/config error.`;

export type ParsedArgs = {
  command?: "list" | "describe" | "run";
  scenario?: string;
  target?: string;
  secret?: string;
  verbose?: boolean;
  error?: string;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  if (!command) {
    return { error: "Missing command.\n\n" + usage };
  }

  if (command === "list") {
    return rest.length === 0
      ? { command: "list" }
      : { error: `Unexpected argument: ${rest[0]}\n\n${usage}` };
  }

  if (command === "describe") {
    if (rest.length === 0) {
      return { error: "Missing scenario name.\n\n" + usage };
    }
    if (rest.length > 1) {
      return { error: `Unexpected argument: ${rest[1]}\n\n${usage}` };
    }
    return { command: "describe", scenario: rest[0] };
  }

  if (command !== "run") {
    return {
      error: `Unknown command: ${command}\n\n${usage}`,
    };
  }

  let scenario: string | undefined;
  let target: string | undefined;
  let secret: string | undefined;
  let verbose = false;

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--target") {
      target = rest[++i];
      if (!target) return { error: "Missing value for --target.\n\n" + usage };
      continue;
    }
    if (arg === "--secret") {
      secret = rest[++i];
      if (!secret) return { error: "Missing value for --secret.\n\n" + usage };
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg.startsWith("-")) {
      return { error: `Unknown flag: ${arg}\n\n${usage}` };
    }
    if (scenario) {
      return { error: `Unexpected argument: ${arg}\n\n${usage}` };
    }
    scenario = arg;
  }

  if (!scenario) {
    return { error: "Missing scenario name.\n\n" + usage };
  }
  if (!target) {
    return {
      error: "Missing required --target <url>.\n\n" + usage,
    };
  }

  return { command: "run", scenario, target, secret, verbose };
}

export function resolveSecret(
  flagSecret: string | undefined,
  env: NodeJS.ProcessEnv,
): string {
  if (flagSecret) return flagSecret;
  if (env.STRIPE_WEBHOOK_SECRET) return env.STRIPE_WEBHOOK_SECRET;
  throw new Error(
    "Missing webhook secret. Pass --secret whsec_… or set STRIPE_WEBHOOK_SECRET.",
  );
}

export async function main(
  argv: string[],
  options: MainOptions = {},
): Promise<number> {
  const io: CliIo = options.io ?? {
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    exit: (code) => process.exit(code),
  };

  const parsed = parseArgs(argv);
  if (parsed.error) {
    io.stderr.write(parsed.error + "\n");
    io.exit(2);
    return 2;
  }

  if (parsed.command === "list") {
    try {
      const scenarios = await listScenarios();
      for (const scenario of scenarios) {
        io.stdout.write(`${scenario.name}\n  ${scenario.summary}\n`);
      }
      io.exit(0);
      return 0;
    } catch (error) {
      io.stderr.write((error as Error).message + "\n");
      io.exit(2);
      return 2;
    }
  }

  if (parsed.command === "describe") {
    try {
      const scenario = await loadScenario(parsed.scenario!);
      io.stdout.write(formatDescription(scenario) + "\n");
      io.exit(0);
      return 0;
    } catch (error) {
      io.stderr.write((error as Error).message + "\n");
      io.exit(2);
      return 2;
    }
  }

  let secret: string;
  try {
    secret = resolveSecret(parsed.secret, io.env);
  } catch (error) {
    io.stderr.write((error as Error).message + "\n");
    io.exit(2);
    return 2;
  }

  let scenario;
  try {
    scenario = await loadScenario(parsed.scenario!);
  } catch (error) {
    io.stderr.write((error as Error).message + "\n");
    io.exit(2);
    return 2;
  }

  const colors = colorsForTty(Boolean(io.stdout.isTTY));

  let result: RunResult;
  try {
    result = await runScenario(
      scenario,
      { target: parsed.target!, secret, verbose: parsed.verbose },
      defaultRunnerDeps({
        ...options.runnerDeps,
        onDelivery: (delivery) => {
          options.runnerDeps?.onDelivery?.(delivery);
          io.stdout.write(formatDeliveryLine(delivery, colors) + "\n");
          if (parsed.verbose) {
            io.stdout.write(formatVerboseDelivery(delivery) + "\n");
          }
        },
      }),
    );
  } catch (error) {
    const message = isConnectionRefused(error)
      ? `nothing is listening on ${parsed.target} — is your app running?`
      : `Request failed: ${error instanceof Error ? error.message : String(error)}`;
    io.stderr.write(message + "\n");
    io.exit(2);
    return 2;
  }

  io.stdout.write("\n" + formatSummary(result, colors) + "\n");
  const code = result.result === "fail" ? 1 : 0;
  io.exit(code);
  return code;
}

export function formatDescription(scenario: ScenarioDefinition): string {
  const lines = [
    scenario.name,
    "",
    scenario.summary,
    "",
    `Catches: ${scenario.catches}`,
    `Assertion: ${scenario.assert ?? "per-delivery expectations"}`,
    "",
    "Deliveries:",
  ];

  scenario.deliveries.forEach((delivery, index) => {
    lines.push(
      `  ${index + 1}. ${delivery.event} (${delivery.id}) — expect ${delivery.expect}` +
        (delivery.delay_ms > 0 ? ` after ${delivery.delay_ms}ms` : ""),
    );
    if (delivery.timestamp_offset_s && delivery.timestamp_offset_s < 0) {
      lines.push(
        `     Signature timestamp: ${Math.abs(delivery.timestamp_offset_s)} seconds in the past`,
      );
    }
  });

  return lines.join("\n");
}

function isConnectionRefused(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    cause?: unknown;
    errors?: unknown[];
  };

  return (
    candidate.code === "ECONNREFUSED" ||
    isConnectionRefused(candidate.cause) ||
    candidate.errors?.some(isConnectionRefused) === true
  );
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith("/cli.ts") ||
    process.argv[1].endsWith("/cli.js") ||
    process.argv[1].endsWith("\\cli.ts") ||
    process.argv[1].endsWith("\\cli.js"));

if (isDirectRun) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(String(error?.stack ?? error) + "\n");
    process.exit(2);
  });
}
