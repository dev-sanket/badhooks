# Working on Stripe webhook handlers

This repo has `badhooks` available. Use it to verify webhook handler changes
before claiming they work.

## When to run it

Run it after any change to Stripe webhook handling — new event types, dedup logic,
refund handling, order fulfillment triggered by payment events. Unit tests will not catch
the failures this tool reproduces, because they test single, ordered, successful
deliveries.

## How to run it

The app must be running locally first. Then:

```bash
badhooks run <scenario> --target http://localhost:3000/webhooks/stripe --json
```

Always pass `--json` — the human-readable output is not meant for parsing.

Discover what's available rather than guessing scenario names:

```bash
badhooks list --json
badhooks describe <scenario> --json
```

Exit codes: `0` pass, `1` fail, `2` usage or config error.

## Reading the result

```json
{
  "scenario": "duplicate-charge-succeeded",
  "result": "fail",
  "assertion": "at_most_one_accepted",
  "deliveries": [
    { "event": "charge.succeeded", "id": "evt_1a2b3c", "replay": false, "status": 200, "expected": "accepted", "ok": true },
    { "event": "charge.succeeded", "id": "evt_1a2b3c", "replay": true,  "status": 200, "expected": "rejected", "ok": false }
  ],
  "diagnosis": "Handler is not deduplicating on event ID.",
  "manual_check_required": "Inspect the database — if two payment rows exist for one charge, this is confirmed.",
  "observable_only": true
}
```

## Important limitation

`observable_only: true` means this tool sees HTTP responses and nothing else. It cannot
read the database.

A `pass` means the endpoint responded correctly. It does **not** prove no duplicate row
was written — a handler can return the right status and still do the work twice. Do not
report a bug as fixed on the basis of a passing run alone; state that responses are
correct and that the database check in `manual_check_required` is still outstanding.

A `fail` is stronger evidence than a `pass`: accepting the same event twice means the
work was almost certainly done twice.

## Suggested loop

1. Change the handler.
2. Restart the app.
3. Run the relevant scenario with `--json`.
4. If `result` is `fail`, read `diagnosis`, fix, and repeat.
5. When it passes, report the remaining manual check rather than declaring the bug closed.

Run the full set before opening a pull request that touches webhook code:

```bash
for s in $(badhooks list --names-only); do
  badhooks run "$s" --target http://localhost:3000/webhooks/stripe --json
done
```