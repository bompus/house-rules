---
description: Prefer zstd, then brotli, then gzip for data you write, with browser negotiation and gzip where another tool must read the file; levels and measurements are in a reference.
after: Implementation economy
reference: ../references/compression-codecs.md
---

## Compression codecs

When you choose how to compress data a project writes itself, prefer zstd, then brotli,
then gzip: the first that every writer and reader supports. Negotiate browser responses
by `Accept-Encoding`. Before choosing levels, choosing between codecs or changing a
working one, read [the compression reference](../references/compression-codecs.md).
