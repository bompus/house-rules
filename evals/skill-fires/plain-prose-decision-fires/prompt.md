---
max_turns: 4
allowed_tools: [Skill]
tags: [trigger, plain-prose]
---

Rewrite this decision for the person who owns the software. They have not read
the working notes. Give a recommendation and two choices with a reply line.
Keep the choice open; do not perform the check or imply permission was granted.

Draft: "Propagation state unresolved. Gate compatibility is unqualified.
Authorize update-channel inspection?"

Facts: another machine might download the proposed change automatically. If it
does, its setup check could fail. We can read that machine's update settings
to find out whether automatic downloads are enabled. This check changes no
settings and does not install or publish anything. The owner can choose that
check now or decline it.
