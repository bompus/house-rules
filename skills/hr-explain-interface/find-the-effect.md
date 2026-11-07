# Finding the layers behind an effect

Search by property signature, not by guessing the element. You rarely know the markup, but you always know which CSS properties could produce what you are looking at.

Run these through whatever browser tooling is available: `evaluate_script` in the Chrome DevTools MCP, the console, a Playwright `page.evaluate`.

## Three things that cost you the answer

**Pseudo-elements carry the effect more often than elements do.** A gradient, a noise overlay, a hairline border, a glow all commonly live on `::before` or `::after`. `getComputedStyle(el)` alone never sees them, so pass the pseudo as the second argument and check all three.

**Idle values are not effects.** `filter: blur(0px)`, `opacity: 1` and `transform: none` are what an animation library leaves on every element it touches. On one real page they turned a search into 97 hits, of which 10 mattered. Filter them out first.

**A generated stop list is one technique, not twelve stops.** Stops at `0%, 9.99%, 19.07%, ...` came from a utility following an easing curve. The extra stops keep the gradient from banding. Name the technique, never paste the stops.

## The layer search

```js
() => {
  const dead = (v) => !v || v === "none" || v === "normal" || v === "1" || v === "blur(0px)";
  const PROPS = [
    "backgroundImage",
    "filter",
    "backdropFilter",
    "mixBlendMode",
    "maskImage",
    "boxShadow",
    "opacity",
  ];
  const hits = [];
  for (const el of document.querySelectorAll("*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const s = getComputedStyle(el, pseudo);
      const found = {};
      for (const p of PROPS) {
        const v = p === "maskImage" ? s.maskImage || s.webkitMaskImage : s[p];
        if (!dead(v)) found[p] = String(v).slice(0, 200);
      }
      if (!Object.keys(found).length) continue;
      if (Object.keys(found).length === 1 && found.opacity) continue; // opacity alone is not an effect
      const r = el.getBoundingClientRect();
      const host = getComputedStyle(el);
      hits.push({
        tag: el.tagName.toLowerCase(),
        pseudo: pseudo ?? "element",
        cls: (el.getAttribute("class") ?? "").slice(0, 90),
        position: host.position,
        z: host.zIndex,
        box: `${Math.round(r.width)}x${Math.round(r.height)} @ x${Math.round(r.left)} y${Math.round(r.top)}`,
        found,
      });
    }
  }
  return { viewport: innerWidth, total: hits.length, hits };
};
```

Read the result for the stack, not for one row:

- **Compare `box` against the viewport.** An element wider than `window.innerWidth`, or with a negative offset, is oversized on purpose so its edges never show.
- **Work out paint order from stacking contexts, not coordinates.** `y` is geometry, and `z-index` only compares elements inside the same stacking context; DOM order and positioning decide the rest. Check which ancestors create a stacking context before asserting that one layer sits above another, and use `elementsFromPoint` below to confirm the order at a sampled pixel. The gradient is usually the lowest layer and the frosted panel the one above it.
- **`backdropFilter` on any row.** That layer frosts something beneath it, so the layer beneath is part of the answer.
- **`mixBlendMode` on any row.** The layer's color depends on what it covers, so you cannot explain it without naming what is underneath.

## When CSS is not the answer

An empty CSS search does not prove the effect is non-CSS. Inventory media elements and loaded resources without creating a drawing context:

```js
() => ({
  libraries: performance
    .getEntriesByType("resource")
    .map((r) => r.name)
    .filter((n) => /three|ogl|pixi|regl|babylon/i.test(n)),
  media: [...document.querySelectorAll("canvas, svg, video, img")].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      box: `${Math.round(r.width)}x${Math.round(r.height)} @ y${Math.round(r.top)}`,
      src: (el.currentSrc || el.getAttribute("src") || "").slice(0, 90),
    };
  }),
});
```

A canvas and a library resource are clues, not proof of the drawing context or a shader. Report that identification as inferred unless other evidence establishes it. Never call `getContext` for passive inspection; it can create a context on an unused canvas. An `svg` may carry `<filter>` primitives worth reading directly.

## Narrowing to a region

Where the page is large, sample what actually paints at a point instead of walking everything:

```js
() => {
  const x = 720,
    y = 300;
  return document
    .elementsFromPoint(x, y)
    .slice(0, 8)
    .map((el) => {
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute("class") ?? "").slice(0, 70),
        bg: s.backgroundImage.slice(0, 80),
        filter: s.filter,
        backdrop: s.backdropFilter,
        blend: s.mixBlendMode,
      };
    });
};
```

`elementsFromPoint` returns front to back, which is the paint stack at that pixel, reversed. It is the fastest way to answer "what is actually behind this", but only for the pixel sampled: it is not a list of every layer, and it skips elements with `pointer-events: none`.

## Is it animated?

```js
() =>
  document
    .getAnimations()
    .slice(0, 20)
    .map((a) => {
      const t = a.effect?.getTiming?.() ?? {};
      return {
        target: a.effect?.target?.tagName?.toLowerCase(),
        cls: (a.effect?.target?.getAttribute?.("class") ?? "").slice(0, 60),
        name: a.animationName ?? a.transitionProperty ?? "(js)",
        duration: t.duration,
        delay: t.delay,
        easing: t.easing,
        keyframes: (a.effect?.getKeyframes?.() ?? []).map(
          ({ offset, easing, opacity, transform, filter }) => ({
            offset,
            easing,
            opacity,
            transform,
            filter,
          }),
        ),
      };
    });
```

`getAnimations()` catches CSS animations, transitions and Web Animations API playback. Read keyframe easing as well as effect timing; a CSS animation can report linear effect easing while its keyframes carry the curve. Compare delays across sibling targets for a stagger.

An empty animation result can mean a one-shot reveal finished or never started. Reload and sample during the reveal, or scroll the target into view. If the chosen browser produces no frames, capture once and sample again; report what remains unobserved.
