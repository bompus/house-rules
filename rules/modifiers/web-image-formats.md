---
description: Prefer WebP for web raster images when it saves bytes at acceptable quality, with format exceptions and delivered-file checks.
after: Writing
---

## Web image formats

When creating, importing or replacing raster images a web project controls,
prefer WebP when its target browsers and publishing pipeline support it.
Compare files at the required dimensions and acceptable visual quality; use
WebP when it reduces bytes while preserving required detail, transparency and
animation. Convert existing assets only within the selected task's scope.

WebP supports lossy and lossless compression and transparency, with broad
browser support. Smaller files reduce data transfer and can shorten image
downloads. Page rendering also depends on discovery, layout and rendering
work; measure page timing separately before claiming a speed gain.

Keep SVG for suitable vector artwork. Use PNG or lossless WebP when exact
pixels or sharp text require it. Choose another supported format, including
AVIF, when a size/quality comparison or required consumer favors it. Preserve
fallbacks that supported clients or integrations require. Keep externally
hosted images in their provider's permitted delivery format; this preference
does not authorize downloading, transcoding or rehosting them.

Preserve editing sources when needed, attribution, alt text, intended crop,
dimensions and responsive sources. Compare the actual derivatives delivered
by the publishing system, whose encoder settings may differ from a local
preview. Verify image responses, MIME types and appearance at the relevant
viewports. A WebP filename alone establishes neither correct encoding nor
smaller delivery. Format and quality selection require judgment; this
preference has no automatic enforcement check.

References: [WebP overview](https://developers.google.com/speed/webp) and
[MDN image formats](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Image_types).
