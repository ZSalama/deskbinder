# Security Policy

Deskbinder is a local desktop worker plus a Convex-backed web companion for running Codex jobs against local repositories. Treat it as developer tooling with access to sensitive local context.

## Reporting Issues

Please report security issues privately to the project maintainer instead of opening a public issue.

Include the affected version or commit, reproduction steps, impact, and any relevant logs with secrets removed.

## Data Synced Through Convex

Deskbinder stores and syncs operational metadata through Convex for authenticated users. This can include:

- Local repository paths and repository names.
- Worker IDs, worker status, and heartbeat timestamps.
- Branch/workspace request state.
- Agent prompts and human-in-the-loop responses.
- Job status, run IDs, Codex thread IDs, errors, and job result summaries.

Do not enter prompts or repository metadata that you would not want stored in the configured Convex deployment. Configure Clerk and Convex access controls carefully before using Deskbinder with private repositories or sensitive work.

## Local Execution Model

The Electron renderer is treated as untrusted. Local filesystem and process access should stay behind explicit IPC handlers in the main process, with a minimal preload API.

Agent jobs and workspace bootstrap scripts execute on the local machine. Repo-owned scripts such as `new_workspace` are trusted user-provided code. Deskbinder validates where configured scripts live and how they are invoked, but it does not sandbox or neutralize script behavior.

## Secrets

Do not commit real `.env` files, Clerk secrets, Convex deployment credentials, API keys, tokens, or agent credentials. The repository includes `.env.example` only as a template.

If a secret is accidentally committed or synced to an external service, rotate it immediately and remove it from the affected history or service logs where practical.
