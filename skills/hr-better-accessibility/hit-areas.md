# Hit areas

Target sizes, expanding hit areas without changing visual size and collision rules and drag alternatives.

## Target sizes

| Standard         | Minimum                  |
| ---------------- | ------------------------ |
| WCAG 2.5.8 (AA)  | 24×24px, with exceptions |
| WCAG 2.5.5 (AAA) | 44×44px                  |
| Apple HIG        | 44×44pt                  |
| Material Design  | 48×48dp                  |

Before reporting an undersized target, check the spacing, equivalent-control, inline, user-agent and essential exceptions.

Under the spacing exception, an undersized target passes when a 24px circle centered on its bounding box intersects no other target and no other undersized target's circle. In the simple case, 20px targets need a 4px gap.

The visible element can stay small; the hit area is what must be big. Anything that looks clickable must be clickable across its whole visual extent.

## Expanding the hit area

Where the visible element is smaller, say a 20×20 checkbox, extend the hit area with a pseudo-element. Put it on the `<label>` that wraps the input, or on the `<button>`, never on the `<input>`, because form controls don't render `::before`/`::after` reliably. A click on a label's pseudo-element activates its control; a plain `<div>` wrapper receives the click and the input never toggles.

### CSS example

```css
/* 20px checkbox with a 44px hit area, on the <label> around the input */
.checkbox-control {
  position: relative;
  width: 20px;
  height: 20px;
}

.checkbox-control::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%; /* physical centering: direction-independent */
  transform: translate(-50%, -50%);
  width: 44px;
  height: 44px;
}
```

### Tailwind example

```tsx
<button
  aria-label="Mark done"
  className="relative size-5 after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-1/2"
>
  <CheckIcon aria-hidden="true" />
</button>
```

### Layout alternative

Where the element can afford real box size, skip the pseudo-element and let the box be the target:

```css
.icon-button {
  min-width: 44px;
  min-height: 44px;
  display: inline-grid;
  place-items: center;
}
```

## Collision rule

Where the extended hit area overlaps another interactive element, shrink the pseudo-element to the largest size that does not collide.

## Decorative layers

A decorative layer painted over interactive content absorbs every pointer event its box covers: a gradient scrim, a glow, a blurred sheen, a full-bleed `::after`. The control underneath looks live and does nothing, and no hit-area sizing fixes it.

Give each one `pointer-events: none` (Tailwind `pointer-events-none`) so events reach the control below. A layer that is an element rather than a pseudo-element also gets `aria-hidden="true"`:

```css
.card-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
```

Keep pointer events on any layer the user is meant to hit: a modal scrim that dismisses on click is a control, not decoration.

## Touch behavior and dragging

- Every drag needs a single-pointer alternative under 2.5.7, such as move-up and move-down buttons on a sortable row, or a menu on a kanban card.
- Every multipoint or path-based gesture, such as a pinch or a swipe, needs a single-pointer alternative under 2.5.1.

- Use `touch-action: manipulation` where removing the mobile tap delay is needed. It permits panning and pinch zoom but disables double-tap zoom on that element; keep the default when that gesture should remain available.
- Set `touch-action: none` on a surface implementing its own pan, zoom, or drag gestures, so the browser stops claiming them for scrolling and pinch-zoom. Scope it to that surface; at page level it removes scrolling.
- Set `touch-action: pan-y` on a horizontal carousel or swipe track that handles horizontal movement itself, so the browser keeps vertical page scrolling. A native `scroll-snap-type: x mandatory` track needs neither the gesture code nor the property.
- Set `-webkit-tap-highlight-color` to match the design instead of the default gray flash.
- Use `-webkit-touch-callout: none` only when a specific control needs to suppress Safari's long-press callout. Preserve it on links and images where users need native copy, share or link actions, including content links.
- Put hover-only styling behind `@media (hover: hover)`. On touch, `:hover` latches after a tap and holds until the user taps elsewhere, so it reads as a stuck selected state. Tailwind 4's `hover:` variant already compiles under this query.
- Prefer generous targets and clear affordances over finicky interactions such as tiny drag handles and precise hover zones.

Desktop emulation cannot verify all mobile browser behavior. Check hover, tap behavior, safe areas and keyboard interaction on supported devices, or report those checks as `Not verified`.
