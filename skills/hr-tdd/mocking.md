# When to mock

Mock at **system boundaries** only:

- External APIs (payment, email, etc.)
- Databases (sometimes; prefer a test DB)
- Time/randomness
- File system (sometimes)

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control

## Designing for mockability

At system boundaries, design interfaces that are easy to mock:

**1. Use dependency injection**

Pass external dependencies in rather than creating them internally:

```typescript
// Easy to mock
function processPayment(order, paymentClient) {
  return paymentClient.charge(order.total);
}

// Hard to mock
function processPayment(order) {
  const client = new StripeClient(process.env.STRIPE_KEY);
  return client.charge(order.total);
}
```

**2. Reuse production interfaces**

Prefer existing operation-specific APIs when they serve production callers. Otherwise mock the transport boundary; request routing in a fake is acceptable. Do not add wrappers solely to simplify mocks. Assert observable results rather than calls to repo-owned helpers.
