## Visuals in issues, discussions and comments

Use an image, chart or diagram only to show a spatial interface state, compare
before and after, show a trend across multiple measurements, or explain a flow
with branches. Otherwise use text, a table or a short code block. Most comments
are text.

Keep the exact numbers, steps or states in text beside the visual, and give the
image alt text, so a reader who cannot see it loses nothing. Label a mockup as an
illustration. Preview a chart or diagram design you have not used before with the
user before posting it.

The destination is usually public. Before posting, check the capture for private
paths, private project or repository names, local usernames, tokens and other
credentials, and follow any capture rule the repository or your host rules
state, such as a required theme.

Attach the file through the project host's supported route. On GitHub,
`gh issue create`, `gh issue edit`, `gh issue comment` and `gh pr comment`
accept `--attach '<file>#<alt text>'` in recent `gh` versions (check
`gh <command> --help`). In a browser form (the route for an issue form), add
the file through a text field's attach control and replace the default alt text
`Image` that the upload inserts. Do not commit the image to the repository or use a
third-party image host. Where no supported attach route exists (`gh discussion`
has no `--attach` flag) or the upload is refused, such as for lack of write
access to the repository, hand the user the exact text and the file instead of
posting another way.

Posting to an external project still needs the user's direction.
