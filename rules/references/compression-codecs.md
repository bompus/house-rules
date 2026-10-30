## Compression codecs

When you choose how to compress data a project writes itself (logs, snapshots,
caches, archives, API payloads), prefer zstd, then brotli, then gzip. Use the
first codec in that order that every writer and reader of the data supports. A
preference does not add a codec to a runtime. Node added `zlib.createZstdCompress`
in 22.15.0 and 23.8.0 and marks it experimental as of Node 26. Check the version
and the API before relying on it.

These figures are single runs on Node. They use three 10.5 MB log files. Zstd at level 9
compressed 10.0 to 13.2 times, brotli at 4 compressed 9.5 to 12.9 times and gzip at
6 compressed 4.9 to 9.8 times. Compression took 9 to 14 ms at zstd 3, 24 to 33 ms
at brotli 4 and 40 to 85 ms at gzip 6. The runs did not time zstd 9 or measure the
ratio at zstd 3, so they do not show zstd winning on both size and speed at one level.

On JSON payloads of 0.1 to 7 MB, also single runs, zstd 3 compressed 1.7 to 2.3
times faster than brotli 4. Its output was 1% to 4% larger up to 1 MB and 19% larger
at 7 MB. All of this comes from a few files in one project, not a general claim.

Treat these levels as starting points and verify them on your data. Use zstd 3 on hot
paths and zstd 9 for cold data kept at rest. Use brotli 4 for responses compressed on
request and brotli 11 for static files compressed ahead of time. The runs above did not
measure brotli 11.

For HTTP responses to browsers, negotiate by `Accept-Encoding` instead of sending
zstd to every client. Pick the first of zstd, brotli and gzip that the header accepts. A coding
listed with `q=0` is not acceptable, so skip it. If none is acceptable, send the
response uncompressed unless the header also rules out `identity`, as `identity;q=0` does.
Then answer 406 Not Acceptable. Zstd content encoding needs Chrome 123, Edge 123
or Firefox 126, or later. Safari takes its support from the operating system. It has
zstd from Safari 26.3 on the 26.3 releases of iOS, iPadOS, visionOS and macOS Tahoe.
Safari on older releases lacks it, and Can I use shows macOS Safari as only partial. Smaller output matters more on high-latency or slow links, where
brotli can win despite slower compression.

Keep gzip where another tool must read the file: `zcat`, tarballs, npm and release
assets. WebSocket compression stays on `permessage-deflate`, the only extension
browsers offer; IANA registers no zstd or brotli extension.

Before choosing between codecs or changing a working one, measure on the real data.
Use `hr-benchmarking`'s defaults: 3 runs per codec, and 2 more when the gap is within
the run-to-run variation. The gain is output size for cold data and compression time
for hot paths. The other measure is a constraint, and it must not get worse outside the
run-to-run variation. Change a working codec only when the gain lies outside that
variation. Converting existing data is outside a task unless the task asks
for it.

References: [Node zlib](https://nodejs.org/api/zlib.html),
[MDN Content-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding),
[WebKit features for Safari 26.3](https://webkit.org/blog/17798/webkit-features-for-safari-26-3/) and
[Can I use zstd](https://caniuse.com/zstd).
