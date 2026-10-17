# Security policy

house-rules is text that agents read and scripts that agents run: the rules, the skills and their helper scripts, and an installer that clones the configured repository (this repository by default) into your data directory, creates a starter config and composes the rules file and skills into your config directory. The installer never edits your agent host's own files, and its only network access is the `git clone` or `git pull` of the configured repository (this repository by default). Skill scripts run with your permissions, and some call out (to `gh` or to public web feeds, for example), as their descriptions say. Anything you put in your own layer is composed in as written, so review rules and skills from other people before you add them.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: open the repository's **Security** tab and choose **Report a vulnerability**. Please do not open a public issue for a security problem.

Include the version, your operating system and runtime (Bun or Node.js, with versions), and steps that reproduce the problem. Report privately anything that lets the installer, the composer or a skill script write outside the directories it is configured to use, run a command the user did not ask for, or leak a credential. A rule or skill that gives an agent poor advice is an ordinary bug; report it as an issue.

## Supported versions

Only the latest release gets fixes.
