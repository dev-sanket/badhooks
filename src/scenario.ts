import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DeliveryExpect = "accepted" | "rejected" | "either";

export type ScenarioAssert = "at_most_one_accepted";

export type ScenarioDelivery = {
  event: string;
  id: string;
  delay_ms: number;
  expect: DeliveryExpect;
};

export type ScenarioDefinition = {
  name: string;
  summary: string;
  catches: string;
  assert?: ScenarioAssert;
  deliveries: ScenarioDelivery[];
  fixtures: Record<string, string>;
};

export type LoadedScenario = ScenarioDefinition & {
  /** Exact UTF-8 fixture bodies keyed by event type. Never re-serialize. */
  bodies: Record<string, string>;
};

export function packageRoot(fromUrl = import.meta.url): string {
  return join(dirname(fileURLToPath(fromUrl)), "..");
}

export async function loadScenario(
  name: string,
  root = packageRoot(),
): Promise<LoadedScenario> {
  const scenarioPath = join(root, "scenarios", `${name}.json`);
  let raw: string;
  try {
    raw = await readFile(scenarioPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(`Unknown scenario: ${name}`);
    }
    throw error;
  }

  const definition = JSON.parse(raw) as ScenarioDefinition;
  if (definition.name !== name) {
    throw new Error(
      `Scenario file name mismatch: expected ${name}, found ${definition.name}`,
    );
  }

  const bodies: Record<string, string> = {};
  for (const [event, relativePath] of Object.entries(definition.fixtures)) {
    const fixturePath = resolve(root, relativePath);
    try {
      bodies[event] = await readFile(fixturePath, "utf8");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        throw new Error(
          `Fixture not found for ${event}: ${relativePath} (scenario ${name})`,
        );
      }
      throw error;
    }
  }

  for (const delivery of definition.deliveries) {
    if (!(delivery.event in bodies)) {
      throw new Error(
        `Scenario ${name} delivery references missing fixture for ${delivery.event}`,
      );
    }
  }

  return { ...definition, bodies };
}
