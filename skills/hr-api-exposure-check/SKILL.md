---
name: hr-api-exposure-check
description: Keep API responses to the fields a real consumer reads and the caller is allowed to read. Use when designing, changing or reviewing what an endpoint, resolver, webhook, serializer or server action returns, or when checking an API for excess data exposure.
---

# API exposure check

A response is both a contract and a disclosure: clients come to depend on
every field, and anyone holding the response can read it. Build responses
from what consumers use, and remove or flag the rest.

## Two answers per field

For every field a response returns, at every depth, write down:

1. **Who uses it.** A named consumer: a client screen, an SDK method, a
   partner integration, a background job, or a published contract that
   promises it.
2. **Why this caller may see it.** The rule that lets this caller, in this
   role, read this value on this object.

A field with both answers stays. A field missing either one is removed. When
removal might break a consumer you cannot see (a public API, a third-party
integration, an old mobile build still in use), do not remove it silently:
report it as unresolved and say what evidence would settle it.

## Finding consumers

Search for actual reads, not declarations:

- client code, including old app versions still supported
- generated or hand-written SDKs and their published docs
- integrations, webhook receivers, scheduled jobs and other services
- OpenAPI, GraphQL schema or protobuf files that are published to others
- contract tests and consumer-driven pacts

A field that appears only in a type definition, a fixture, a mock or a
snapshot has no proven consumer. Code that spreads or forwards the whole
object proves nothing either; follow it to the place that reads a named
field. If a field is part of a published, versioned contract, it leaves
through a deprecation: mark it, announce it, keep it for the stated window,
then remove it in a new version.

## Cover the whole response

The top-level object is the easy part. Check each of these too:

- nested objects and embedded relations, which often serialize a full model
- every item in a list, and the shape of an empty list
- pagination and metadata blocks (total counts can reveal what the caller
  cannot otherwise see)
- response headers, including debug, server and timing headers
- error bodies, for every status the endpoint can return
- each role or tenant variant of the same endpoint
- webhook payloads and server-action return values, which are easy to forget

Hiding a field in the UI does not protect it. The raw response is visible in
browser tools, proxies and logs. If the screen should not show it, the server
should not send it.

## Building responses

- Map from an explicit allowlist or a purpose-built output type per use. Never
  serialize a whole model or database row and then delete the fields you
  remember. A column added next month will leak by default under that pattern.
- Check access to the object and to each sensitive field before mapping, not
  after. Mapping first and filtering later invites a code path that forgets
  the filter.
- When the client chooses fields (GraphQL selections, `fields=` or `include=`
  parameters, sparse fieldsets), intersect its request with a server-side
  allowlist for that caller. A client request never widens what the caller
  may see.
- Give errors their own minimal shape: a stable code, a short message safe to
  show, and a request or correlation ID. Stack traces, SQL, internal paths,
  upstream responses and validation internals go to the server log.
- Prefer separate output types for separate audiences (public, owner, admin)
  over one type with conditional blanks. A `null` where a field used to be
  still tells the reader the field exists.

## High-risk fields

Treat these as exposure by default and require a strong second answer:

- credentials, tokens, password hashes, API keys, session or reset data
- personal data: contact details, addresses, birth dates, government IDs,
  location, health data
- financial data: card or bank details, balances, billing history
- permission internals, role lists, feature flags, fraud or risk scores,
  moderation notes
- internal identifiers that enable enumeration, plus hostnames, IPs, bucket
  names, queue names, versions and other infrastructure details
- any data belonging to another user or tenant

## Tests

For each caller type, assert the exact set of keys, or validate against a
closed schema that rejects unknown properties. Include:

- fields that must be absent for this caller, named explicitly
- nested objects and list items, not only the top level
- error responses, for each status the endpoint returns
- a guard that adding a field to the underlying model does not change the
  response; a closed schema or exact key set does this for free

A test that only checks that expected fields are present will pass while
extra fields leak.

## Reporting findings

When reviewing, sort each finding into one of three kinds:

- **Exposure**: a caller can read data it should not. State who can read
  what, how they would get it, and the impact.
- **Unneeded surface**: a field with no consumer but no sensitive content.
  Worth removing to shrink the contract; not a vulnerability.
- **Unresolved**: you could not confirm the consumer or the access rule.
  Name what you checked and what would settle it.

Give each finding a confidence level and the evidence behind it. Do not call
every extra field a security issue; that buries the findings that are. For
a broader change review, hand the rest to `hr-code-review`.

## Sources

- OWASP API Security Top 10 (2023), API3: [Broken Object Property Level
  Authorization](https://owasp.org/API-Security/editions/2023/en/0xa3-broken-object-property-level-authorization/),
  which merges excessive data exposure and mass assignment.
- OWASP Web Security Testing Guide, on testing for excessive data exposure.
- GDPR ([Regulation 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj))
  Article 5(1)(c) on data minimisation and Article 25 on data protection by
  design and by default.
