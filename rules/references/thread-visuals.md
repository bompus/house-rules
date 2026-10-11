## Visuals in issues, discussions and comments

Add an image, chart or diagram to an issue, a discussion or a comment on one
only when it shows what text cannot say as fast: a visible interface state, a
before/after pair, a measured series with many points, or a flow with branches.
A table or a short code block is often enough. Skip a visual for one number, a
small change or decoration. Most comments are text.

Keep the exact numbers, steps or states in text beside the visual, and give the
image alt text, so a reader who cannot see it loses nothing. Label a mockup as
an illustration. Preview a chart or diagram design you have not used before with
the user before posting it.

The destination is usually public. Before posting, check the capture for private
paths, private project or repository names, local usernames, tokens and other
credentials, and follow any capture rule the repository or your host rules
state, such as a required theme.

Attach the file through the command: `gh issue create`, `gh issue edit`, `gh
issue comment` and `gh pr comment` accept `--attach '<file>#<alt text>'` in
recent `gh` versions (check `gh <command> --help`). Do not commit the image to
the repository or use a third-party image host. Where no supported attach route
exists (`gh discussion` has no `--attach` flag) or the upload is refused, such
as for lack of write access to the repository, hand the user the exact text and
the file instead of posting another way.

Posting to an external project still needs the user's direction.
