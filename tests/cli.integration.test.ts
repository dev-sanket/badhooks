import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { describe, it } from "node:test";
import { main } from "../src/cli.js";

async function listen(
  handler: (
    req: IncomingMessage,
    body: string,
  ) => { status: number; body?: string },
): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const result = handler(req, body);
      res.statusCode = result.status;
      res.setHeader("Content-Type", "application/json");
      res.end(result.body ?? "{}");
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  return { server, url: `http://127.0.0.1:${address.port}/webhooks/stripe` };
}

function captureIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let exitCode: number | undefined;
  return {
    stdoutChunks: stdout,
    stderrChunks: stderr,
    get exitCode() {
      return exitCode;
    },
    io: {
      stdout: {
        write: (chunk: string) => {
          stdout.push(chunk);
        },
        isTTY: false,
      },
      stderr: {
        write: (chunk: string) => {
          stderr.push(chunk);
        },
      },
      env: { STRIPE_WEBHOOK_SECRET: "whsec_test_secret" },
      exit: (code: number) => {
        exitCode = code;
      },
    },
  };
}

describe("cli integration", () => {
  it("passes when the replay is rejected", async () => {
    const seen = new Set<string>();
    const { server, url } = await listen((req, body) => {
      assert.equal(req.method, "POST");
      assert.equal(req.headers["content-type"], "application/json");
      const signature = String(req.headers["stripe-signature"] ?? "");
      const match = /^t=(\d+),v1=([a-f0-9]+)$/.exec(signature);
      assert.ok(match);
      const [, t, v1] = match;
      const expected = createHmac("sha256", "whsec_test_secret")
        .update(`${t}.${body}`, "utf8")
        .digest("hex");
      assert.equal(v1, expected);

      const event = JSON.parse(body) as { id: string };
      if (seen.has(event.id)) {
        return { status: 409 };
      }
      seen.add(event.id);
      return { status: 200 };
    });

    const captured = captureIo();
    const sleeps: number[] = [];
    try {
      const code = await main(
        ["run", "duplicate-charge-succeeded", "--target", url],
        {
          io: captured.io,
          runnerDeps: {
            sleep: async (ms) => {
              sleeps.push(ms);
            },
          },
        },
      );
      assert.equal(code, 0);
      assert.equal(captured.exitCode, 0);
      assert.deepEqual(sleeps, [3000]);
      const out = captured.stdoutChunks.join("");
      assert.match(out, /✓ PASS {2}duplicate-charge-succeeded/);
      assert.match(out, /\(replay\)/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("is inconclusive with exit 0 when both deliveries are accepted", async () => {
    const { server, url } = await listen(() => ({ status: 200 }));
    const captured = captureIo();
    try {
      const code = await main(
        [
          "run",
          "duplicate-charge-succeeded",
          "--target",
          url,
          "--secret",
          "whsec_test_secret",
        ],
        {
          io: { ...captured.io, env: {} },
          runnerDeps: { sleep: async () => {} },
        },
      );
      assert.equal(code, 0);
      assert.equal(captured.exitCode, 0);
      const out = captured.stdoutChunks.join("");
      assert.match(out, /\? INCONCLUSIVE {2}duplicate-charge-succeeded/);
      assert.match(out, /Stripe recommends\s+acknowledging duplicates/);
      assert.match(out, /can't see whether work happened twice/);
      assert.match(out, /Check your database/);
      assert.doesNotMatch(out, /not deduplicating on event ID/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("exits 2 when --target is missing", async () => {
    const captured = captureIo();
    const code = await main(["run", "duplicate-charge-succeeded"], {
      io: captured.io,
    });
    assert.equal(code, 2);
    assert.equal(captured.exitCode, 2);
    assert.match(captured.stderrChunks.join(""), /Missing required --target/);
  });

  it("exits 2 when secret is missing", async () => {
    const captured = captureIo();
    const code = await main(
      [
        "run",
        "duplicate-charge-succeeded",
        "--target",
        "http://127.0.0.1:9/webhooks/stripe",
      ],
      { io: { ...captured.io, env: {} } },
    );
    assert.equal(code, 2);
    assert.match(captured.stderrChunks.join(""), /STRIPE_WEBHOOK_SECRET/);
  });

  it("lists every available scenario without requiring a secret", async () => {
    const captured = captureIo();
    const code = await main(["list"], { io: { ...captured.io, env: {} } });

    assert.equal(code, 0);
    assert.match(captured.stdoutChunks.join(""), /duplicate-charge-succeeded/);
    assert.match(captured.stdoutChunks.join(""), /refund-before-payment/);
    assert.match(
      captured.stdoutChunks.join(""),
      /charge-and-payment-intent-succeeded/,
    );
    assert.match(captured.stdoutChunks.join(""), /delayed-charge-succeeded/);
  });

  it("describes a scenario without requiring a secret", async () => {
    const captured = captureIo();
    const code = await main(["describe", "delayed-charge-succeeded"], {
      io: { ...captured.io, env: {} },
    });

    assert.equal(code, 0);
    const out = captured.stdoutChunks.join("");
    assert.match(out, /delayed-charge-succeeded/);
    assert.match(out, /charge\.succeeded/);
    assert.match(out, /90 seconds in the past/);
  });

  it("prints request and response bodies with --verbose", async () => {
    const { server, url } = await listen(() => ({
      status: 409,
      body: '{"received":true}',
    }));
    const captured = captureIo();
    try {
      const code = await main(
        [
          "run",
          "delayed-charge-succeeded",
          "--target",
          url,
          "--verbose",
        ],
        {
          io: captured.io,
          runnerDeps: { sleep: async () => {} },
        },
      );

      assert.equal(code, 1);
      assert.equal(captured.exitCode, 1);
      const out = captured.stdoutChunks.join("");
      assert.match(out, /Request body:/);
      assert.match(out, /"id": "evt_late_90s"/);
      assert.match(out, /Response body:/);
      assert.match(out, /{"received":true}/);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });

  it("explains connection refusal without printing a stack trace", async () => {
    const probe = await listen(() => ({ status: 200 }));
    const url = probe.url;
    await new Promise<void>((resolve, reject) => {
      probe.server.close((err) => (err ? reject(err) : resolve()));
    });

    const captured = captureIo();
    const code = await main(
      ["run", "duplicate-charge-succeeded", "--target", url],
      {
        io: captured.io,
        runnerDeps: { sleep: async () => {} },
      },
    );

    assert.equal(code, 2);
    assert.equal(captured.exitCode, 2);
    const error = captured.stderrChunks.join("");
    assert.equal(
      error.trim(),
      `nothing is listening on ${url} — is your app running?`,
    );
    assert.doesNotMatch(error, /TypeError|fetch failed|at node:/);
  });
});
