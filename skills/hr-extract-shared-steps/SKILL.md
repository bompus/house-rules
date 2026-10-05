---
name: hr-extract-shared-steps
description: Pull operational steps that several workflows repeat into shared functions with explicit inputs and results, leaving each workflow's own decisions with its caller. Use when the same low-level operation (a provider call, a command run, a message sent, a resource provisioned) appears in two or more callers, when a fix landed in one copy but not the others, or when a new feature needs mechanics an existing flow already has. Not for single-caller logic, naming, or general interface design.
---

# Extract shared steps

Several workflows often perform the same operation with slightly different
code around it: one checkout path and one renewal job both charge a card, two
handlers both run the same CLI command. The copies drift, and a fix applied to
one leaves the others broken. This skill moves the operation into one shared
function and leaves every decision about when, whether and what next with the
workflow that owns it.

## Confirm it applies

Extract when at least one of these is true, and you can point to the lines:

- Two or more callers perform the same low-level operation with the same
  inputs, calls and error handling, give or take naming.
- A bug fix or provider change landed in one copy and the others still carry
  the old behavior.
- A new feature is about to copy mechanics that an existing flow already has.

Stop and leave the code alone when the logic has one caller, when the copies
only look alike but encode different product rules, or when the real question
is naming or how a module's interface should look.

## Draw the line between policy and operation

Go through the repeated code line by line and sort each line with this test:
would a second caller ever want this line to behave differently? If yes, it is
policy and stays in the caller. If no, it is part of the operation.

Policy, which stays with each caller:

- who may trigger the action, and any permission or plan checks
- state transitions on the caller's own records (order paid, subscription past due)
- which failures reach the user, and the wording they see
- whether to retry, when, and how many times
- logging or metrics that name the workflow

Operation, which moves into the shared function:

- building the request, calling the provider or command, parsing the response
- mapping raw provider errors into a small, stable set of failure kinds
- anything that must be identical everywhere for correctness, such as an
  idempotency key format or a required header

## Shape the shared function

- Take everything it needs as parameters: clients, identifiers, amounts,
  timeouts. It does not reach for globals, request context or configuration
  on its own.
- Do not read or write application state or the database inside it. The caller
  loads what the operation needs and stores what comes back.
- Return a structured result that makes failure explicit: success with its
  data, or a failure kind plus the raw detail. Never swallow an error or
  return a bare `false` the caller cannot interpret.
- Offer several small operations a caller can combine rather than one entry
  point with flags for each caller's variant. Two callers needing different
  steps call different functions.
- Keep argument order, naming and result shape consistent across sibling
  operations, so a reader who knows one knows the rest.

Extract only what is repeated today and not specific to one product flow. A
step only one caller needs stays in that caller, even if it sits next to the
shared part.

## Example

Checkout charges a card while the customer waits; the renewal job charges
the same card overnight. Both used to build the provider request inline.

```ts
type ChargeResult =
  | { ok: true; chargeId: string }
  | { ok: false; kind: "declined" | "unavailable" | "invalid"; detail: string };

async function chargeCard(client: PaymentClient, input: {
  customerRef: string; amountCents: number; currency: string; idempotencyKey: string;
}): Promise<ChargeResult> { /* request, call, map provider errors to kind */ }

// Checkout: show declines to the customer, never retry.
const paid = await chargeCard(client, { ...order.charge, idempotencyKey: order.id });
if (!paid.ok) return showPaymentError(paid.kind);
await orders.markPaid(order.id, paid.chargeId);

// Renewal job: retry outages later, mark the subscription past due on decline.
const renewed = await chargeCard(client, { ...sub.charge, idempotencyKey: `${sub.id}:${period}` });
if (!renewed.ok && renewed.kind === "unavailable") return scheduleRetry(sub.id);
if (!renewed.ok) return subs.markPastDue(sub.id, renewed.detail);
await subs.recordPayment(sub.id, renewed.chargeId);
```

`chargeCard` knows nothing about orders, subscriptions or retries. Each caller
decides what a decline means for its own records.

## Migrate in steps

1. Write the shared function from the most complete copy, with tests for its
   success path and each failure kind. Done when those tests pass.
2. Switch one caller to it. Done when that caller's tests, the type check and
   the linter pass, and its observable behavior is unchanged.
3. Switch the remaining callers one at a time with the same checks. Where the
   copies differed, decide whether the difference was policy (keep it in that
   caller) or a bug (fix it, and say so in the change description).
4. Delete the old inline copies. Done when a search for the old request
   building or provider call finds only the shared function.
5. Run the project's full required checks before landing.

## Check the result

Revisit the extraction when any of these appear, now or in later changes:

- The shared function grew a parameter or mode flag that exists for one
  caller. Move that step back to the caller or split the function.
- It writes domain state, or reads it to decide what to do. That is policy
  leaking in; return the data and let the caller act.
- It has a single caller left. Inline it back unless a second caller is
  already planned in this change.
- Callers inspect raw provider errors again instead of the failure kind. The
  result type is missing a case.

Report what was extracted, which callers moved, any behavior difference you
found between the copies and how you resolved it, and the checks you ran.
