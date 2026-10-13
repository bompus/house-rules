---
max_turns: 4
allowed_tools: [Skill]
tags: [trigger, plain-prose]
---

I'm done with the flaky-test fix. Here's my scratch log; turn it into the
final report I send the user before ending the session.

- cause: `test_upload_retry` slept 100 ms and assumed the mock server was up;
  on CI the server sometimes took 300 ms to bind
- fix: wait on the server's ready event instead of sleeping (tests/conftest.py)
- ran the test 200 times locally: 200 pass (was ~6% fail)
- CI: one green run on the PR, #418
- left: two other tests use the same sleep pattern (test_download_resume,
  test_auth_refresh); not touched
