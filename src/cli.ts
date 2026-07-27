#!/usr/bin/env node
import { loadScenario } from "./scenario.js";
import { colorsForTty, formatDeliveryLine, formatSummary } from "./report.js";
import {
  defaultRunnerDeps,
  runScenario,
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
  badhooks run <scenario> --target <url> [--secret whsec_…]

Exit codes: 0 pass, 1 fail, 2 usage/config error.`;

export function parseArgs(argv: string[]): {
  command?: string;
  scenario?: string;
  target?: string;
  secret?: string;
  error?: string;
} {
  const [command, ...rest] = argv;
  if (!command) {
    return { error: "Missing command.\n\n" + usage };
  }
  if (command !== "run") {
    return {
      error: `Unknown command: ${command}\n\n${usage}`,
    };
  }

  let scenario: string | undefined;
  let target: string | undefined;
  let secret: string | undefined;

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

  return { command, scenario, target, secret };
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

  const result = await runScenario(
    scenario,
    { target: parsed.target!, secret },
    defaultRunnerDeps({
      ...options.runnerDeps,
      onDelivery: (delivery) => {
        options.runnerDeps?.onDelivery?.(delivery);
        io.stdout.write(formatDeliveryLine(delivery, colors) + "\n");
      },
    }),
  );

  io.stdout.write("\n" + formatSummary(result, colors) + "\n");
  const code = result.passed ? 0 : 1;
  io.exit(code);
  return code;
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
