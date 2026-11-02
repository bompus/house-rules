---
description: Prefer zstd, then brotli, then gzip for data you write, with browser negotiation and gzip where another tool must read the file; levels and measurements are in a reference.
after: Implementation economy
reference: ../references/compression-codecs.md
---

## Compression codecs

When you choose how to compress data a project writes itself, prefer zstd, then brotli,
then gzip: the first that every writer and reader supports. A preference does not add a
codec to a runtime; check its version and API before relying on one. Negotiate browser
responses by `Accept-Encoding` and skip any coding listed with `q=0`, keep gzip where another tool must read the file, and
treat converting existing data as outside the task unless asked. Before implementing or
changing HTTP negotiation, choosing levels, choosing between codecs or changing a working
one, read
[the compression reference](../references/compression-codecs.md).
