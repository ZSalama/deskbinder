# Deskbinder

Deskbinder is a Linux-first Electron, React, TypeScript, and Convex app for running Codex jobs against local repositories. It pairs a local desktop worker with a web companion so authenticated users can track repositories, launch agent work, and keep job state synchronized through Convex.

The renderer is intentionally untrusted. Local filesystem and process access stay behind explicit IPC handlers in the Electron main process, while the preload layer exposes a narrow typed API to the React UI.

## Features

- Register local Git repositories from the desktop app.
- Sync repository readiness and worker status through Convex.
- Start Codex jobs against a selected repository from the desktop or web UI.
- Stream agent output into the dashboard transcript.
- Configure repo-owned workspace bootstrap scripts such as `new_workspace`.
- Track running workspace processes and clean them up through the desktop worker.
- Use Clerk authentication for both desktop and web sessions.

## Project Layout

- `apps/desktop`: Electron + Vite + React desktop worker and dashboard.
- `apps/web`: Next.js web companion for remote dashboard access.
- `convex`: shared Convex schema, auth config, functions, tests, and generated API.
- `packages/shared`: shared Deskbinder domain types and IPC contracts.
- `packages/convex-client`: re-exports for the root Convex generated API.

## Requirements

- Linux for the primary desktop target.
- Node.js and pnpm.
- A Convex project.
- A Clerk application with a Convex JWT template.
- Codex installed on machines that will run agent jobs.

## Getting Started

Install dependencies:

```sh
pnpm install
```

Use the example environment file as a template for the Clerk and Convex values:

```sh
cp .env.example .env.local
```

When running the desktop or web app locally, make sure the relevant variables are available to that app process. Exporting them in your shell before running the `pnpm dev:*` commands is the most direct option.

Run Convex in one terminal:

```sh
pnpm dev:convex
```

Run the desktop app in another terminal:

```sh
pnpm dev:desktop
```

Optionally run the web companion:

```sh
pnpm dev:web
```

## Environment

Both apps use the same Clerk and Convex deployment, but each framework needs its own public environment variable prefix.

- Desktop app: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL`
- Web app: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CONVEX_URL`
- Shared auth config: `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`

See `.env.example` for the expected names.

## Commands

- `pnpm dev:desktop`: run the Electron desktop app.
- `pnpm dev:web`: run the Next.js web app.
- `pnpm dev:convex`: run the Convex dev server.
- `pnpm build`: build the desktop and web apps.
- `pnpm lint`: lint the workspace.
- `pnpm typecheck`: typecheck every package.
- `pnpm test:convex`: run Convex tests.
- `pnpm test:desktop`: build the desktop app and run Playwright tests.
- `pnpm --filter @deskbinder/desktop build:linux`: build Linux desktop packages.

## Workspace Bootstrap Scripts

Deskbinder can run repo-owned workspace bootstrap scripts, such as `new_workspace`, when creating or preparing a workspace.

These scripts are treated as trusted, user-provided code. Deskbinder validates where the configured script lives and how it is invoked, but it does not attempt to sandbox or neutralize the behavior of the script itself.

Users are responsible for any filesystem changes, spawned processes, network access, credential use, and other side effects caused by scripts they configure.

## Roadmap

- Improve the desktop and web dashboard UX.
- Add richer human-in-the-loop review flows.
- Add a diff viewer for agent changes.
- Add first-class agent cancellation controls.

## License

Deskbinder is licensed under the MIT License. See `LICENSE` for details.
