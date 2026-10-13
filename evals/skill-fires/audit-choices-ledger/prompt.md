---
max_turns: 8
allowed_tools: [Skill]
tags: [output, review]
---

I asked a subagent for exactly this: "Add a CSV export of orders to the admin orders page." It's done and the tests pass. Before I merge, list the decisions it made that I never asked for. Here is the whole change:

```diff
+// package.json
+    "papaparse": "^5.4.1",
+
+// src/admin/orders-export.ts
+import Papa from "papaparse";
+import { writeFileSync, createReadStream } from "node:fs";
+import { db } from "../db";
+
+const MAX_ROWS = 10_000;
+
+export async function exportOrders(req, res) {
+  const rows = await db.orders.findMany({
+    include: { customer: true },
+    orderBy: { createdAt: "desc" },
+    take: MAX_ROWS,
+  });
+  const flat = rows.map((o) => ({
+    id: o.id,
+    total: o.total,
+    createdAt: o.createdAt.toLocaleString(),
+    customerName: o.customer.name,
+    customerEmail: o.customer.email,
+    shippingAddress: o.customer.address,
+  }));
+  const path = `/tmp/exports/orders-${Date.now()}.csv`;
+  writeFileSync(path, Papa.unparse(flat));
+  res.setHeader("Content-Type", "text/csv");
+  createReadStream(path).pipe(res);
+}
+
+// src/admin/routes.ts
+router.get("/admin/orders.csv", requireAdmin, exportOrders);
```
