#!/usr/bin/env python3
"""Render a before/after benefit chart as a PNG for a pull request, issue or discussion.

Usage: benefit-chart.py <spec.json> <out.png> [--table]

The spec holds a headline, a workload line and one row per measured metric:

    {
      "headline": "Sidebar search: typing one letter takes 319 ms, was 1,136 ms",
      "workload": "1,300 threads, 1,057 matches, dev build; median of 3 runs",
      "arms": ["Before", "After"],
      "band": 0.03,
      "note": "Lower is better.",
      "rows": [
        {"label": "Type one letter", "before": 1136, "after": 319, "unit": "ms"},
        {"label": "Renders", "before": 36950, "after": 7693, "unit": "",
         "words": ["fewer", "more"]}
      ]
    }

Row fields: label, before, after, unit (text after the value), lower_is_better
(default true), words (the two words after the percentage, for a good and a bad
change; default "lower"/"higher", or "higher"/"lower" when lower_is_better is false), and
note (extra text under the label). band is required: the variation criterion
declared before the first run, as a fraction of the baseline. A change at or
inside it is labeled "no clear change". Bars start at zero and share a scale per row.

Values must be non-negative. Prints the alt text for the image on stdout. With --table it
also prints a Markdown table of the same values, the text version of the chart
for readers and agents that cannot parse the image. Requires matplotlib.
"""
import json
import math
import sys
import textwrap

try:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import FancyBboxPatch
except ImportError:
    sys.exit("benefit-chart.py needs matplotlib (pip install matplotlib).")

BACKGROUND = "#0d1117"
TEXT = "#e6edf3"
MUTED = "#9da7b3"
BEFORE = "#6e7681"
GOOD = "#3fb950"
BAD = "#f85149"
NEUTRAL = "#8b949e"


def fmt(value):
    magnitude = abs(value)
    if float(value).is_integer():
        return f"{value:,.0f}"
    if magnitude >= 100:
        return f"{value:,.0f}"
    if magnitude >= 10:
        return f"{value:,.1f}"
    if magnitude >= 1:
        return f"{value:,.2f}"
    return f"{value:,.3f}"


def band_of(spec):
    if "band" not in spec:
        sys.exit('spec needs a top-level "band": the declared variation criterion as a fraction '
                 "of the baseline, such as 0.04.")
    try:
        if isinstance(spec["band"], bool):
            raise TypeError
        band = float(spec["band"])
    except (TypeError, ValueError):
        band = float("nan")
    if not math.isfinite(band) or band < 0:
        sys.exit('spec "band" must be a finite non-negative number.')
    return band


def judge(row, band):
    before, after = float(row["before"]), float(row["after"])
    lower_is_better = row.get("lower_is_better", True)
    if before == 0:
        return NEUTRAL, "no baseline to compare", "no baseline to compare"
    change = (after - before) / before
    if abs(change) <= band:
        return NEUTRAL, "no clear change", "no clear change"
    improved = change < 0 if lower_is_better else change > 0
    default_words = ("lower", "higher") if lower_is_better else ("higher", "lower")
    words = row.get("words") or default_words
    word = words[0] if improved else words[1]
    percent = abs(change) * 100
    if 99 <= percent < 100:
        percent_text = f"{int(percent * 10) / 10:.1f}%"  # never rounds up to "100%"
    else:
        percent_text = f"{percent:,.0f}%" if percent >= 10 else f"{percent:,.1f}%"
    ratio = max(before, after) / min(before, after) if min(before, after) > 0 else None
    times = f" ({ratio:,.1f}×)" if ratio and ratio >= 1.5 else ""
    text = f"{percent_text} {word}{times}"
    return (GOOD if improved else BAD), text, text


def render(spec, out_path):
    rows = spec["rows"]
    for row in rows:
        if float(row["before"]) < 0 or float(row["after"]) < 0:
            sys.exit(f"row {row['label']!r}: negative values are not supported (bars start at zero).")
    band = band_of(spec)
    arms = spec.get("arms", ["Before", "After"])
    count = len(rows)
    headline_lines = textwrap.wrap(spec["headline"], 54)
    head = 0.75 + 0.45 * len(headline_lines)
    height = head + 0.6 + 1.25 * count + (0.5 if spec.get("note") else 0.2)
    fig = plt.figure(figsize=(10, height), dpi=160, facecolor=BACKGROUND)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.set_xlim(0, 10)
    ax.set_ylim(0, height)
    ax.axis("off")
    ax.set_facecolor(BACKGROUND)

    top = height - 0.3
    ax.text(0.4, top, "\n".join(headline_lines), color=TEXT, fontsize=19, fontweight="bold",
            va="top", linespacing=1.25)
    ax.text(0.4, top - 0.4 * len(headline_lines) - 0.2, spec.get("workload", ""), color=MUTED,
            fontsize=10.5, va="top")

    arm_right, bar_left, bar_span = 1.35, 1.5, 5.6
    y = height - head - 0.45
    alts = []
    for row in rows:
        before, after = float(row["before"]), float(row["after"])
        unit = row.get("unit", "")
        suffix = f" {unit}" if unit else ""
        color, badge, alt_badge = judge(row, band)
        top_value = max(before, after) or 1.0
        ax.text(0.4, y, row["label"], color=TEXT, fontsize=12.5, fontweight="bold", va="center")
        ax.text(9.6, y, badge, color=color, fontsize=15, fontweight="bold", va="center", ha="right")
        if row.get("note"):
            ax.text(0.4, y - 0.24, row["note"], color=MUTED, fontsize=9, va="center")
        bars = ((arms[0], before, BEFORE), (arms[1], after, color))
        for index, (arm, value, bar_color) in enumerate(bars):
            bar_y = y - 0.5 - index * 0.32
            width = max(bar_span * value / top_value, 0.03)
            ax.add_patch(FancyBboxPatch((bar_left, bar_y - 0.11), width, 0.22,
                                        boxstyle="round,pad=0,rounding_size=0.04",
                                        linewidth=0, facecolor=bar_color))
            ax.text(arm_right, bar_y, arm, color=MUTED, fontsize=9.5, va="center", ha="right")
            ax.text(bar_left + width + 0.12, bar_y, f"{fmt(value)}{suffix}", color=TEXT,
                    fontsize=10.5, va="center")
        row_alt = f"{row['label']}: {fmt(before)}{suffix} to {fmt(after)}{suffix}, {alt_badge}"
        if row.get("note"):
            row_alt += f" ({row['note']})"
        alts.append(row_alt)
        y -= 1.25

    if spec.get("note"):
        ax.text(0.4, 0.3, spec["note"], color=MUTED, fontsize=9.5, va="center")
    fig.savefig(out_path, facecolor=BACKGROUND)
    plt.close(fig)
    lead = spec["headline"] + (f". {spec['note']}" if spec.get("note") else "")
    if spec.get("workload"):
        lead += f". Workload: {spec['workload']}"
    return f"{lead}. " + "; ".join(alts) + "."


def table(spec):
    band = band_of(spec)
    arms = spec.get("arms", ["Before", "After"])
    lines = [f"| Metric | {arms[0]} | {arms[1]} | Change |", "| --- | ---: | ---: | --- |"]
    for row in spec["rows"]:
        suffix = f" {row['unit']}" if row.get("unit") else ""
        change = judge(row, band)[2]
        label = row["label"].replace("|", "\\|")
        lines.append(f"| {label} | {fmt(float(row['before']))}{suffix} | "
                     f"{fmt(float(row['after']))}{suffix} | {change} |")
    notes = [f"Workload: {spec['workload']}"] if spec.get("workload") else []
    notes += [spec["note"]] if spec.get("note") else []
    notes += [f"{row['label']}: {row['note']}" for row in spec["rows"] if row.get("note")]
    if notes:
        lines += ["", *notes]
    return "\n".join(lines)


def main():
    args = [a for a in sys.argv[1:] if a != "--table"]
    if len(args) != 2:
        sys.exit(__doc__)
    with open(args[0]) as handle:
        spec = json.load(handle)
    print(render(spec, args[1]))
    if "--table" in sys.argv[1:]:
        print()
        print(table(spec))


if __name__ == "__main__":
    main()
