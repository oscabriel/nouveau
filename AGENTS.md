- This project uses [Convex](https://convex.dev) as its backend. When working on backend code using Convex, **always read `.agents/docs/convex-guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

- This project uses [Ultracite](https://ultracite.ai), a zero-config preset that enforces strict code quality standards through automated formatting and linting. When you're done making changes to this codebase, refer to `.agents/docs/code-standards.md` to ensure your changes align with code quality expectations.

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`gh` CLI) on `oscabriel/nouveau`. See `.agents/docs/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `.agents/docs/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `.agents/docs/domain.md`.
