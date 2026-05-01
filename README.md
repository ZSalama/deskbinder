# Deskbinder Monorepo

Deskbinder now lives in a small pnpm workspace so the desktop shell and web app can share one Convex backend and generated API.

## Workspace Layout

- `apps/desktop`: Electron + Vite + React desktop app
- `apps/web`: Next.js web app
- `packages/shared`: shared Deskbinder types and IPC contracts
- `packages/convex-client`: thin re-exports for the root Convex generated API
- `convex`: shared Convex schema, functions, and generated types

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
