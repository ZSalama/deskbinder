# Electron Rules (Strict Minimal)

## Architecture

- Renderer = untrusted
- Main = authority
- Preload = only bridge
- Shared types define the contract between preload and renderer
- All privileged behavior lives behind explicit IPC handlers in main

Flow:
renderer → preload → IPC → main

No direct Node/OS access from renderer.

---

## BrowserWindow Baseline

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true` unless there is a documented, unavoidable blocker
- `webSecurity: true`
- `allowRunningInsecureContent: false`

- Preload path must be explicit and local
- Use a single window creation path with hardened defaults
- Deny `window.open` by default; allow only audited external URLs via main
- Block renderer navigation to unexpected origins or file paths
- Prefer `shell.openExternal` only for an allowlisted set of protocols (`https:` and `mailto:` if needed)

---

## Security

- nodeIntegration: false
- contextIsolation: true

- Preload exposes minimal, typed APIs only
- Validate ALL IPC input in main
- Never execute raw user input (whitelist commands only)

- Normalize + validate all file paths (no ../ traversal)
- Resolve paths against an approved root before use
- Block external navigation + arbitrary remote content
- Register a permission handler; deny by default unless a capability is intentionally required
- Never expose secrets to renderer
- Never expose raw Electron APIs to renderer unless individually reviewed
- Escape or sanitize untrusted content before rendering it in the UI

---

## IPC Contract

- Use `ipcMain.handle`/`ipcRenderer.invoke` for request/response APIs
- Use `ipcMain.on` only for true fire-and-forget events
- Centralize channel names in one module
- Version channels with a stable prefix like `v1.agent.run`
- One handler owns one channel
- Validate payloads and return shapes at the main boundary
- Return structured errors; do not leak stack traces or filesystem details to renderer
- Prefer small, composable IPC endpoints over a generic "run anything" bridge

---

## Performance

- No blocking work in main (use async / workers)
- Keep preload small
- Stream outputs (no large buffering)

---

## Structure

- main: system + execution
- preload: bridge only
- renderer: UI

- Centralized IPC
- Version IPC APIs (e.g. v1.\*)
- Keep shared IPC types in a dedicated module, not duplicated across layers
- Main should contain orchestration, not UI state
- Renderer should treat preload APIs like a remote service boundary

Suggested layout:

- `src/main/ipc/` for channel registration and validators
- `src/main/services/` for filesystem, execution, and workspace logic
- `src/shared/` for IPC types, enums, and safe constants
- `src/preload/` for the minimal bridge surface

---

## Preload Rules

- Expose an app-specific `window.api` surface only
- Do not expose `electron`, `ipcRenderer`, or broad toolkit helpers directly to renderer
- Each preload function should map to a narrow, documented capability
- Keep preload stateless; no business logic, no filesystem logic, no command logic
- Export TypeScript declarations for every exposed API

---

## Agent Constraints

- Sandbox to working directory
- Whitelisted commands only
- Enforce timeouts + concurrency limits
- Stream execution output
- Set explicit max stdout/stderr size and truncation behavior
- Track child processes and ensure cancellation/cleanup on window close or app quit
- Separate command construction from user input; pass args as arrays, never shell-concatenate
- Default-deny writes outside the workspace root
- Log execution metadata in main without exposing sensitive host details to renderer

---

## Filesystem Rules

- Canonicalize with `resolve`/`normalize` before access
- After resolution, verify the target still stays within the approved workspace root
- Treat symlinks as untrusted until resolved and verified
- Prefer explicit allowlists for readable/writable paths
- Use async filesystem APIs; avoid sync calls in hot paths or IPC handlers

---

## Dev Rules

- In development, a dev server URL is still untrusted input; load only the expected local origin
- Do not add dependencies that widen the renderer privilege boundary without a clear reason
- If a feature needs more preload surface area, document the API, threat model, and validation path in the same change
- Security-sensitive defaults must be preserved in refactors and template updates

---

## Principles

- Renderer is hostile
- Validate everything
- Minimize surface area
- Be explicit
- Prefer capability-specific APIs over convenience
- Secure defaults beat flexible defaults

---

## UI rules

- Use Shadcn components whenever possible

---

## Project information

**Deskbinder** is a Linux-first Electron + Vite + React + TypeScript desktop app that acts as a local worker for running Codex jobs against local repositories.
