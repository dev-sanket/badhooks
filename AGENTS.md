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
badhooks run <scenario> --target http://localhost:3000/webhooks/stripe
```

Discover what's available rather than guessing scenario names:

```bash
badhooks list
badhooks describe <scenario>
```

Exit codes: `0` pass or inconclusive, `1` proven fail, `2` usage or config error.

## Reading the result

- `PASS`: the HTTP responses satisfy the scenario.
- `FAIL`: the HTTP responses prove an expectation was missed.
- `INCONCLUSIVE`: the responses are valid but cannot reveal whether work happened once
  or twice. Exit code remains `0`; perform the database check printed by badhooks.

## Important limitation

badhooks sees HTTP responses and nothing else. It cannot read the database. Stripe
recommends returning `2xx` for duplicate events after doing no work, so two accepted
responses are not evidence of duplicate processing. In that case, report the result as
inconclusive and carry the printed database check into your summary.

Do not report a bug as fixed from HTTP responses alone when badhooks says
`INCONCLUSIVE`.

## Suggested loop

1. Change the handler.
2. Restart the app.
3. Run the relevant scenario.
4. If it fails, read the diagnosis, fix, and repeat.
5. If it is inconclusive, perform the printed database check.

Run the full set before opening a pull request that touches webhook code:

```bash
for s in duplicate-charge-succeeded refund-before-payment \
  charge-and-payment-intent-succeeded delayed-charge-succeeded; do
  badhooks run "$s" --target http://localhost:3000/webhooks/stripe
done
```