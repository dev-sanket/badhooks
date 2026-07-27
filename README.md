# badhooks

Reproduce the Stripe webhook failures that are hardest to test locally.

Your webhook handler worked perfectly in staging.

Then production delivered `charge.succeeded` twice, three seconds apart. One customer
got charged twice, and you can't reproduce it on your machine — the Stripe CLI sends
each event once, in order, and always succeeds.

```bash
badhooks run duplicate-charge-succeeded \
  --target http://localhost:3000/webhooks/stripe
```

```
→ charge.succeeded             evt_1a2b3c              200 OK   42ms
→ charge.succeeded  (replay)   evt_1a2b3c              200 OK   38ms

? INCONCLUSIVE  duplicate-charge-succeeded

  Both deliveries returned 200. That's valid — Stripe recommends
  acknowledging duplicates rather than rejecting them.

  badhooks can't see whether work happened twice.
  Check your database: one payment row for evt_1a2b3c = correct.
  Two = the bug.

  (A 409 on the replay would let badhooks confirm this automatically.)
```

No Stripe account. No Stripe CLI. Just your endpoint and your webhook secret.

---

## Install

```bash
npm install -g badhooks
```

Or without installing:

```bash
npx badhooks list
```

## Setup

Export the webhook signing secret your app verifies against, so scenario events pass
your signature check like real ones:

```bash
export STRIPE_WEBHOOK_SECRET=whsec_your_local_secret
```

That's it. Events are generated and signed locally — nothing is sent to Stripe, and no
API key is involved.

## Quickstart

Start your app, then run a scenario against its webhook endpoint:

```bash
# see what's available
badhooks list

# read what a scenario sends before you run it
badhooks describe refund-before-payment

# run it
badhooks run refund-before-payment \
  --target http://localhost:3000/webhooks/stripe
```

A passing run looks like this:

```
→ charge.refunded              evt_9f8e7d              409 Conflict   31ms
→ charge.succeeded             evt_4c5d6e              200 OK         28ms

✓ PASS  refund-before-payment

  Endpoint rejected a refund for a charge it had never seen.
```

Runs are deterministic: the same scenario sends the same events, with the same event
IDs, in the same order, with the same delays, every time. A failure you see once is a
failure you can hand to a coworker.

## Scenarios

| Scenario | What it sends | The bug it catches |
| --- | --- | --- |
| `duplicate-charge-succeeded` | The same `charge.succeeded` event twice, three seconds apart | Handler isn't idempotent on event ID — the customer is charged or credited twice |
| `refund-before-payment` | `charge.refunded` before the `charge.succeeded` it belongs to | Handler assumes ordering — negative balances, orphaned refund rows |
| `charge-and-payment-intent-succeeded` | `payment_intent.succeeded` and `charge.succeeded` for one payment — different event IDs, same money | Deduplicating on event ID isn't enough; both events fulfill the same order twice |
| `delayed-charge-succeeded` | `charge.succeeded` arriving 90 seconds late, after your app has given up | Handler ignores or rejects a late success — customer paid, order never fulfilled |

## What it checks

Scenarios assert on what's observable over HTTP: status codes, delivery count, ordering,
and response timing. A `2xx` response does not prove work happened: Stripe recommends
acknowledging duplicate events even when the handler performs no work. In ambiguous
cases, badhooks reports `INCONCLUSIVE` and tells you exactly what to inspect.

It cannot see inside your database. When a scenario fails, it tells you what to go look
for — it doesn't claim to have found it.

## Commands

```bash
badhooks list                    # all available scenarios
badhooks describe <scenario>     # the event sequence and what's asserted
badhooks run <scenario>          # run against --target
```

| Flag | Description |
| --- | --- |
| `--target <url>` | Your local webhook endpoint (required) |
| `--secret <whsec_...>` | Signing secret, if you'd rather not use the env var |
| `--verbose` | Print full request and response bodies |

Exit code is `0` on pass or inconclusive, `1` on a proven failure, and `2` on usage or
configuration errors.

## Contributing

New scenarios are the most useful contribution. A scenario belongs here if it describes
a delivery failure that actually happened to someone in production and is hard to
trigger with the Stripe CLI.

If you hit a payment bug you couldn't reproduce locally, open an issue describing the
incident. The reproduction sequence is worth more than the code.

## License

MIT