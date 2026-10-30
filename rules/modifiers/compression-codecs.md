---
description: Prefer zstd, then brotli, then gzip for data you write, with browser negotiation and gzip where another tool must read the file; levels and measurements are in a reference.
after: Implementation economy
reference: ../references/compression-codecs.md
---

## Compression codecs

When you choose how to compress data a project writes itself (logs, snapshots,
caches, archives, API payloads), prefer zstd, then brotli, then gzip. Use the
first codec in that order that every writer and reader of the data supports. A
preference does not add a codec to a runtime: check the runtime's version and
API before relying on one (Node's zstd is experimental).

For HTTP responses to browsers, negotiate by `Accept-Encoding` instead of
sending zstd to every client: pick the first of zstd, brotli and gzip the header
accepts, and skip any coding listed with `q=0`. Keep gzip where another tool
must read the file (`zcat`, tarballs, npm, release assets). WebSocket
compression stays on `permessage-deflate`.

Before choosing levels, choosing between codecs or changing a working one, read
[the compression reference](../references/compression-codecs.md) for starting
levels, the single-run measurements behind them, negotiation edge cases,
browser support and how to measure on the real data. Converting existing data
is outside a task unless the task asks for it.
