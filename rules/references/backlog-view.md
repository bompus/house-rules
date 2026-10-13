## Backlog view

Whenever any item remains in a backlog, remaining-work or walk-through report,
show one panel of every open item beside the table, not only when the user asks
to see the backlog. Group the items by what each waits on and order the groups
bottom-up, so the items that can move sit last, next to the offer:

1. **Waiting on others or a date**, with its count and "not work to start yet".
   A table with Trigger, Item and Owner columns, in date order with undated
   events last. A long path or list goes on a second line under its item.
   Never start these items or offer them.
2. **Needs your decision**, with its count. One bordered row per question: a Q
   badge carrying the offer's question number, the item, a muted second line
   with its status and owner, and answer chips on the right: the question's own
   option codes when the offer uses codes (`1A`, `1B`), otherwise yes, no and
   defer. The chips repeat the offer's choices; they are not controls and are
   never a second set of reply labels. Mark the group being
   asked "group N of M, this reply" in the header, tinted, with an accent rail
   beside its rows. Put that group last, with its highest-ranked question last
   within it.
3. **Actionable now**, with its count. Keep the group when it is empty: write
   "Nothing." and the reason.

The panel has a fixed dark background (`#12151c`) with text `#e6e8ee` and muted
text `#98a1b5` (7.0:1 on the panel). Triggers are `#8fb4ff`; the current group
and Q badges use `#ffd479`, with dark text on the badge. Group names, counts,
Q numbers and the words "this reply" carry the meaning, not color alone. Below
about 520 px wide it becomes one column: hide the column headings and stack
trigger, item and owner. Render it with the host's own preview or rendering
tool, and check it at desktop and phone widths when the tool allows. Build it
from this skeleton, with the report's own items:

```html
<div class="w">
  <section>
    <h4>1. Waiting on others or a date · 2 <small>not work to start yet</small></h4>
    <div class="cols"><span>Trigger</span><span>Item</span><span>Owner</span></div>
    <div class="r">
      <span class="d">Oct 14</span><span>Vendor replies to the support ticket</span
      ><span class="mu">vendor</span>
    </div>
  </section>
  <section class="cur">
    <h4>2. Needs your decision · 1 <small>group 1 of 1, this reply</small></h4>
    <div class="dq">
      <span class="q">Q1</span>
      <span class="t">Drop the unused cache layer?<span class="m">parked · web app</span></span>
      <span class="a"><span>yes</span><span>no</span><span>defer</span></span>
    </div>
  </section>
  <section>
    <h4>3. Actionable now · 0</h4>
    <div class="none">Nothing. Every other open item waits on a date or someone else.</div>
  </section>
</div>
<style>
  .w {
    background: #12151c;
    color: #e6e8ee;
    border-radius: 10px;
    padding: 16px;
    font:
      13px/1.45 system-ui,
      sans-serif;
  }
  .w section {
    margin: 0 0 14px;
  }
  .w section:last-child {
    margin: 0;
  }
  .w h4 {
    margin: 0 0 6px;
    padding: 5px 10px;
    background: #181c27;
    border-radius: 6px;
    color: #c9d1e3;
    display: flex;
    justify-content: space-between;
  }
  .w small,
  .mu,
  .m {
    color: #98a1b5;
    font-weight: 400;
  }
  .cols,
  .r {
    display: grid;
    grid-template-columns: 132px 1fr 168px;
    gap: 10px;
    padding: 6px 10px;
    border-bottom: 1px solid #1c2130;
  }
  .cols {
    color: #98a1b5;
    font-size: 12px;
  }
  .d {
    color: #8fb4ff;
  }
  .none {
    padding: 6px 10px;
    color: #98a1b5;
  }
  .cur h4 {
    background: #2a2410;
    color: #ffd479;
    box-shadow: inset 3px 0 0 #ffd479;
  }
  .dq {
    display: grid;
    grid-template-columns: 34px 1fr auto;
    gap: 8px;
    border: 1px solid #ffd479;
    border-radius: 8px;
    padding: 7px 10px;
    margin: 8px 0;
  }
  .q {
    background: #ffd479;
    color: #12151c;
    border-radius: 4px;
    font-weight: 700;
    text-align: center;
    align-self: start;
  }
  .m {
    display: block;
    font-size: 12px;
  }
  .a span {
    border: 1px solid #2a3040;
    border-radius: 5px;
    padding: 0 7px;
    margin-left: 4px;
  }
  @media (max-width: 520px) {
    .cols {
      display: none;
    }
    .r {
      grid-template-columns: 1fr;
    }
  }
</style>
```

Where the host has no render tool, give the same groups as a Markdown outline:
numbered group headings with counts, one bullet per item with its trigger in
bold first and its owner last, Q labels in bold, and "▶ group N of M, this
reply" on the group being asked. The offer keeps its own format; the view adds
no offer.
