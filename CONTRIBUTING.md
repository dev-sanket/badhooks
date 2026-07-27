# Contributing to badhooks

The most useful contribution is a scenario. If you hit a webhook bug you couldn't
reproduce locally, that's exactly what this project is for.

## What belongs here

A scenario belongs in badhooks if all three are true:

1. **It happened.** Someone hit this in production, or it's documented as a known
   delivery behavior by the provider. Not a hypothetical sequence that seems plausible.
2. **The provider's own CLI can't reproduce it.** `stripe listen` sends each event once,
   in order, successfully. If you can already trigger it there, badhooks adds nothing.
3. **A wrong handler is visibly wrong over HTTP.** badhooks sees status codes and
   delivery counts, not your database. If the only symptom is internal state, we can't
   assert on it — see the limits below.

Things that don't fit: single well-formed events, malformed JSON, signature-verification
tests (that's the provider SDK's job), and anything requiring the tool to intercept your
outbound API calls.

## Opening an issue is contributing

**You don't need to write code.** The reproduction sequence is the valuable part — the
JSON is the easy part. Open an issue with:

- What the provider delivered, and in what order
- What your handler did wrong
- What the correct handling would have been
- Whether you could reproduce it locally, and how you eventually diagnosed it

That's enough for someone to turn into a scenario. Real incident reports are worth more
to this project than pull requests.

## Adding a scenario

Scenarios are data. One JSON file in `scenarios/`, no code:

```json
{
  "name": "duplicate-charge-succeeded",
  "summary": "The same charge.succeeded event delivered twice, 3s apart.",
  "catches": "Handler isn't idempotent on event ID — customer charged twice.",
  "assert": "at_most_one_accepted",
  "deliveries": [
    { "event": "charge.succeeded", "id": "evt_1a2b3c", "delay_ms": 0,    "expect": "accepted" },
    { "event": "charge.succeeded", "id": "evt_1a2b3c", "delay_ms": 3000, "expect": "rejected" }
  ],
  "fixtures": { "charge.succeeded": "fixtures/charge.succeeded.json" }
}
```

Assertions available:

| Value | Meaning |
| --- | --- |
| `accepted` | 2xx |
| `rejected` | 4xx |
| `either` | passes regardless — use where both designs are defensible |
| `at_most_one_accepted` | across the whole sequence, no more than one 2xx |

### Rules

**Determinism.** Event IDs, object IDs, amounts, and delays are literals. No randomness,
no timestamps generated at runtime inside payload bodies. Two runs must produce identical
requests apart from the signature timestamp.

**Real payload shapes.** Copy the event body from the provider's documentation and trim
it to the fields a handler actually reads. Invented field names get the project dismissed
on sight.

**Name it the way the incident gets searched.** `duplicate-charge-succeeded`, not
`idempotency-test`. `refund-before-payment`, not `out-of-order`. People arrive here
Googling their bug, not our vocabulary.

**Say what it catches.** The `catches` field names the defect in one sentence. It's what
appears in `describe` output and it's the reason someone runs the scenario.

### Checklist

- [ ] `badhooks describe <name>` reads clearly to someone who's never seen the scenario
- [ ] Fails against a naive handler; passes against a correct one — verify both
- [ ] Same result on two consecutive runs
- [ ] Fixture reuses an existing file in `fixtures/` where possible

## What badhooks can't assert

badhooks observes HTTP responses only. It cannot read your database.

A pass means your endpoint responded correctly. It does not prove no duplicate row was
written — a handler can return the right status and still do the work twice. Failure
output must therefore point at what to check rather than claim to have found it.

Don't submit scenarios or output copy that overstates this. Being trustworthy about the
limit is worth more than sounding thorough.

## Providers other than Stripe

Adding one means a new signer variant plus a `scenarios/<provider>/` directory. Open an
issue first — the interesting question is which failures that provider actually has, and
that's worth discussing before anyone writes code.

## Development

```bash
npm install
npm test          # signer tests first — everything depends on them
npm run build
node dist/cli.js run duplicate-charge-succeeded --target http://localhost:3000/webhooks/stripe
```

Keep dependencies minimal. A payments-adjacent tool with a large dependency tree is a
hard sell, and a new dependency needs a reason in the PR description.

## Licensing

Contributions are accepted under the MIT license. By opening a pull request you agree
your contribution is licensed under the same terms as the project. There is no CLA.
