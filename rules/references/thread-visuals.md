## Visuals in issues, discussions and comments

Use an image, chart or diagram only to show a spatial interface state, compare
before and after, show a trend across multiple measurements, or explain a flow
with branches. Otherwise use text, a table or a short code block. Most comments
are text. The exception is a qualified measured result. It lies outside the reporting band
and meets its declared variation criterion. An
issue, discussion or pull request that reports one opens with a headline chart
of it, so a reader sees the benefit before reading the body. A result with
one row that moved by less than 10% stays text and a table.
`hr-writing-pr`'s `scripts/benefit-chart.py` draws it. A comment that only adds data to an
existing thread stays text and a table.

Keep the exact numbers, steps or states in text beside the visual, and give the
image alt text, so a reader who cannot see it loses nothing. Many readers of an
issue or pull request are agents that cannot parse an image. Every value, label
and caveat in the visual also appears as body text, such as a table, a list or a
described state. The alt text says what the image shows, not only that it is a
chart. Label a mockup as an
illustration. Preview a chart or diagram design you have not used before with the
user before posting it.

The destination is usually public. Before posting, check the capture for private
paths, private project or repository names, local usernames, tokens and other
credentials, and follow any capture rule the repository or your host rules
state, such as a required theme.

Attach the file through the project host's supported route. On GitHub,
`gh issue create`, `gh issue edit`, `gh issue comment` and `gh pr comment`
accept `--attach '<file>#<alt text>'` in recent `gh` versions (check
`gh <command> --help`). In a browser form (the route for an issue form), use
the form's upload field when it renders. When it does not, add the file through
a text field's attach control and replace the default alt text `Image` that the
upload inserts. Do not commit the image to the repository or use a
third-party image host. Where the CLI has no attach route (`gh discussion` has
no `--attach` flag) or refuses the upload, such as for lack of write access to
the repository, use a browser signed in to the user's GitHub account: the page's
upload field takes the file where `--attach` does not. Hand the user the exact
text and the file only when the host has no such browser or the upload fails
there, and do not post another way.

Posting to an external project still needs the user's direction.
