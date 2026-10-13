---
max_turns: 6
allowed_tools: [Skill]
tags: [trigger, review, routing-baseline]
---

Review this change for standards and spec conformance:

```diff
-  if (user.isAdmin) { grantAccess(); }
+  if (user.isAdmin && user.mfaVerified) { grantAccess(); }
```

The spec requires MFA for all admin access grants.
