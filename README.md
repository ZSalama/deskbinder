# Deskbinder Monorepo

Deskbinder now lives in a small pnpm workspace so the desktop shell and web app can share one Convex backend and generated API.

## Workspace Layout

- `apps/desktop`: Electron + Vite + React desktop app
- `apps/web`: Next.js web app
- `packages/shared`: shared Deskbinder types and IPC contracts
- `packages/convex-client`: thin re-exports for the root Convex generated API
- `convex`: shared Convex schema, functions, and generated types

## Workspace Bootstrap Scripts

Deskbinder supports running repo-owned workspace bootstrap scripts such as `ainewworkspace`.

These scripts are intentionally treated as trusted, user-provided code. Deskbinder validates where the configured script lives and how it is invoked, but it does not attempt to sandbox or neutralize the behavior of the script itself.

Users are expected to provide these scripts and take full responsibility for the consequences of running them, including filesystem changes, spawned processes, network access, credential use, and any other side effects caused by the script.

## Commands

- `pnpm dev:desktop`: run the Electron app
- `pnpm dev:web`: run the Next.js app
- `pnpm dev:convex`: run the shared Convex dev server
- `pnpm build`: build desktop and web
- `pnpm lint`: lint the workspace
- `pnpm typecheck`: typecheck every package that exposes a typecheck script

## Environment

Both apps use the same Clerk and Convex deployment, but each framework needs its own public env prefix.

- Desktop app: `VITE_CLERK_PUBLISHABLE_KEY`, `VITE_CONVEX_URL`
- Web app: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CONVEX_URL`
- Shared auth config: `CLERK_SECRET_KEY`, `CLERK_JWT_ISSUER_DOMAIN`

## Features/work in progress

- remove notification cards on the top of transcription section
- set busy to be per branch
- improve codex log display in desktop app
- remove unused ui components
- human-in-the-loop

## HITL prompt

Create a file named HITL_TEST.md.

Then stop and ask the user: “Should I continue with option A or option B?”

Do not proceed until the user answers.
