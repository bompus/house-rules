# CPU priority findings: 2026-10-06

Read this record before answering whether negative, zero or positive nice values
improved the tested workload. Reuse these results for the same question; a new
experiment needs a materially different workload, contention regime or hypothesis.
Follow the host's authorization rules before changing priority or measuring again.

## Result and scope

Negative nice did not establish a timing or memory benefit in this small WSL
allocation experiment. Verified effective nice 0 was the only setting that met
the preset variation criterion for both runtimes. It is a baseline candidate for
comparable isolated measurements, not a universal priority policy.

The workload performed 16,384 warmup and 65,536 measured `Buffer.alloc(size, 1)`
operations, cycling 1,000, 16,000, 128,000 and 1,000,000-byte buffers and retaining
at most 128 references. Timing and CPU cover the measured loop; peak RSS covers
the whole process. This allocation case is also reported in
[Bun issue 44661](https://github.com/oven-sh/bun/issues/44661).
This is a priority sensitivity comparison, not a general Bun-versus-Node ranking,
a contention-resistance test or an explanation of that issue's root cause.

## Recorded experiment

The measured interval was 2026-10-06 23:42:55Z–23:45:40Z. Bun 1.4.2 and
Node 26.10.0 used unchanged sources and binaries. Three independent processes
per runtime/priority cell ran in counterbalanced order, for 24 processes total.
All passed correctness, effective-control and quiet-host admission checks;
none was rejected. The preset criterion was `(maximum - minimum) / median <= 10%`.

Controls were Windows-hosted WSL, Linux kernel 7.2.8 with an unverified custom
scheduler implementation, ordinary fair scheduling, unprivileged workload UID
1000, CPU affinity 0–7 and identical 704 MiB `memory.high`/`memory.max` limits.
No CPU quota was present at inspected cgroup ancestors. The launcher set absolute
priority before dropping privileges and verified it afterward; the workload did
not run as root. Main-thread scheduler wait included warmup and cannot establish
timed-region or all-GC-thread scheduling effects.

| Runtime | Nice | Median wall ms | Wall range ms |   Span | Median CPU ms | Median peak RSS MiB | Variation passes |
| ------- | ---: | -------------: | ------------: | -----: | ------------: | ------------------: | ---------------- |
| bun     |  +10 |         1445.9 | 1195.6–1467.9 | 18.83% |        1812.3 |               191.5 | no               |
| bun     |   +0 |         1356.4 | 1326.5–1412.4 |  6.34% |        1778.9 |               191.3 | yes              |
| bun     |  -10 |         1416.1 | 1291.2–1468.1 | 12.49% |        1781.2 |               189.2 | no               |
| bun     |  -20 |         1346.1 | 1287.4–1497.2 | 15.58% |        1691.4 |               190.1 | no               |
| node    |  +10 |         1196.5 | 1083.8–1231.8 | 12.37% |        1849.8 |               193.5 | no               |
| node    |   +0 |         1136.2 | 1133.3–1138.5 |  0.46% |        1735.8 |               192.1 | yes              |
| node    |  -10 |         1148.1 | 1097.3–1152.7 |  4.82% |        1747.0 |               191.9 | yes              |
| node    |  -20 |         1191.7 | 1189.9–1277.3 |  7.33% |        1825.9 |               192.7 | yes              |

Bun +10, -10 and -20 failed the variation criterion. Node -10 overlapped nice 0;
Node -20 was slower. These three-process samples support no confirmed negative
priority gain. The small quiet-host cohort does not predict behavior under
contention or on another scheduler. The per-process measurement values below
make the reported aggregates auditable; their scope limits still apply.

## Per-process measurement values

These are the 24 retained output measurements used above, with path and process
identity fields omitted. Repetition numbers identify each process within its
runtime/priority cell; they are not execution order. CPU is in microseconds and
peak RSS in KiB to retain the source units. Wall values retain nine decimal
places for aggregate recalculation, not a claim of clock accuracy.

Recalculation from these samples matches every aggregate before display rounding.
Each source output passed correctness and effective-control checks before and
after the workload. No process was rejected. The broader host-admission receipts
remain outside this bundle; this table provides sample-level auditability for
the reported wall, CPU, RSS and variation values, not complete host reproduction.

| Runtime | Nice | Repetition |        Wall ms |  CPU us | Peak RSS KiB |
| ------- | ---: | ---------: | -------------: | ------: | -----------: |
| bun     |  +10 |          1 | 1195.596419000 | 1505936 |       196116 |
| bun     |  +10 |          2 | 1445.887323000 | 1812345 |       190948 |
| bun     |  +10 |          3 | 1467.863081000 | 1852217 |       197132 |
| bun     |   +0 |          1 | 1326.456355000 | 1659644 |       195900 |
| bun     |   +0 |          2 | 1412.394017000 | 1778913 |       189540 |
| bun     |   +0 |          3 | 1356.414170000 | 1779749 |       199772 |
| bun     |  -10 |          1 | 1291.186539000 | 1638686 |       190644 |
| bun     |  -10 |          2 | 1468.095042000 | 1847875 |       195332 |
| bun     |  -10 |          3 | 1416.096128000 | 1781215 |       193692 |
| bun     |  -20 |          1 | 1287.427399000 | 1628746 |       194676 |
| bun     |  -20 |          2 | 1497.167736000 | 1893806 |       191196 |
| bun     |  -20 |          3 | 1346.090557000 | 1691437 |       195036 |
| node    |  +10 |          1 | 1083.811791000 | 1655921 |       200988 |
| node    |  +10 |          2 | 1196.507378000 | 1849814 |       198100 |
| node    |  +10 |          3 | 1231.812016000 | 1913550 |       197184 |
| node    |   +0 |          1 | 1138.547173000 | 1717254 |       196524 |
| node    |   +0 |          2 | 1136.151985000 | 1735839 |       197480 |
| node    |   +0 |          3 | 1133.265512000 | 1736305 |       196716 |
| node    |  -10 |          1 | 1097.328563000 | 1684817 |       196008 |
| node    |  -10 |          2 | 1152.692612000 | 1789165 |       197780 |
| node    |  -10 |          3 | 1148.141853000 | 1746972 |       196516 |
| node    |  -20 |          1 | 1277.348138000 | 1994581 |       196600 |
| node    |  -20 |          2 | 1191.670413000 | 1825925 |       197344 |
| node    |  -20 |          3 | 1189.945316000 | 1821113 |       198976 |

## Omitting nice versus requesting zero

A child inherits its parent's nice value, and `exec` preserves it. Omitting
`nice` therefore yields zero only when the parent already has effective nice 0.
GNU `nice -n 0 COMMAND` adds zero to the inherited value; it does not reset +10
to zero. Bare `nice COMMAND` applies the default +10 adjustment. `setpriority`
sets an absolute value, subject to permissions; verify the effective value
rather than treating the requested command as proof.

Positive nice lowers CPU scheduling priority; negative nice raises it. Neither
reserves a core or replaces host admission and resource controls. Keep effective
values equal across ordinary comparison arms. General +10 background/build
policies serve responsiveness and are separate from this experiment; these
results do not authorize removing them or changing installed settings.

Sources: [Linux getpriority/setpriority](https://man7.org/linux/man-pages/man2/setpriority.2.html)
for inheritance, absolute values and permissions; [GNU nice](https://www.gnu.org/software/coreutils/manual/html_node/nice-invocation.html)
for relative adjustment. GNU online retrieval was unavailable during verification;
the installed command's help confirmed the adjustment and default +10.
