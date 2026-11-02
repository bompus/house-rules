---
description: Prefer WebP for web raster images when it saves bytes at acceptable quality, with format exceptions and delivered-file checks.
after: Writing
reference: ../references/web-image-formats.md
---

## Web image formats

Prefer WebP for raster images a web project controls when its target browsers and
publishing pipeline support it and it saves bytes at acceptable quality; keep SVG for
vector artwork, and convert existing assets only within the selected task's scope.
Preserve attribution, alt text and fallbacks that supported clients need. This
preference does not authorize downloading, transcoding or rehosting externally hosted
images. Before creating, importing or replacing a web image, read
[the image-format procedure](../references/web-image-formats.md).
