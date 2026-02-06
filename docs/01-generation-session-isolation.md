# 01 – Generation: session isolation per user

This document describes how and why we isolate the **Generate** flow (balance-calculator clone, config, and generated files) **per browser/session**, so that multiple users or tabs do not share data or interfere with each other.

---

## Why we do this

- **Shared backend, multiple users**  
  The app can be used by several people at once (e.g. demo or shared instance). Without isolation, everyone would see the same list of generated files and use the same balance-calculator clone. One user’s rebuild or upload could affect what others see and run.

- **Clear boundaries**  
  Each user should only see and manage **their own** generated files (on both the Generate page and the Upload page “Fichiers générés” section) and their own balance-calculator clone and config.

- **Predictable behavior**  
  If a user returns later in the **same browser**, they should find their previous files and clone again (session persisted in the browser). Different browsers or devices get different sessions and thus different workspaces.

- **Controlled storage**  
  To avoid unbounded growth, we remove workspaces that have been inactive for a fixed period (e.g. 2 weeks).

---

## How we handle it

We introduce a **session identifier** that is:

1. **Generated and stored in the browser** (e.g. in `localStorage`) so the same device/browser keeps the same session across visits.
2. **Sent to the server** on every request that touches generation or generated files (e.g. via a header like `X-Session-Id`).
3. **Used on the server** to isolate:
   - the **workspace** (directory) where balance-calculator is cloned and where generated files are stored,
   - the **list**, **upload**, **delete**, and **download** of generated files,
   - and all **balance-calculator** operations (clone, rebuild, config, run) for that session.

So: **one session ID ⇒ one workspace ⇒ one balance-calculator clone and one set of generated files.**

---

## Client side

- **Session ID**  
  A UUID is generated once and stored in `localStorage` under a fixed key (e.g. `powervoting_session_id`). If the key is missing or invalid, a new UUID is generated and stored.

- **Sending the session**  
  Every request that must be isolated (list files, upload, delete, balance-calculator start/answer/config, rebuild, etc.) includes the header **`X-Session-Id`** with that UUID. The composable `useSessionId` (and helpers like `sessionHeaders()`) centralize reading and attaching this value.

- **Generated file URLs**  
  The API returns file URLs that already include the session (e.g. `/generated/<sessionId>/<filename>`). The client uses these URLs as-is for download; no extra header is required for the download request because the session is in the path.

---

## Server side

- **Workspace layout**  
  For each valid session ID we use a dedicated directory, e.g.:

  - `workspaces/<sessionId>/`
  - `workspaces/<sessionId>/balance-calculator/` (clone of the repo)
  - `workspaces/<sessionId>/balance-calculator/outDatas/` (generated files)

  All paths for that session are derived from `getWorkspacePath(sessionId)`, `getBalanceCalculatorPath(sessionId)`, and `getOutDatasPath(sessionId)`.

- **Validation**  
  The session ID is validated (e.g. UUID format). Invalid or missing IDs for protected routes result in a `400` with a clear message so the client can ensure a valid ID is sent.

- **Protected routes**  
  Routes that read or write generated files or the balance-calculator clone use a middleware (e.g. `ensureSession`) that:
  - Reads `X-Session-Id` (or equivalent),
  - Validates it,
  - Attaches the resolved `sessionId` to the request,
  - Uses the session-scoped paths above for file system and process operations.

  Examples: `GET/POST /api/files`, `DELETE /api/files/:filename`, `GET /generated/:sessionId/:filename`, balance-calculator start/answer/config, rebuild, etc.

- **Serving generated files**  
  Generated files are served under a path that includes the session (e.g. `GET /generated/:sessionId/:filename`), so each URL is scoped to one session and path traversal is prevented by resolving paths inside that session’s `outDatas` only.

---

## Cleanup policy (inactive workspaces)

- **Goal**  
  Avoid storing data forever. Workspaces that are not used for a long time are removed.

- **Activity tracking**  
  On each use of a session’s workspace (list files, upload, delete, start/rebuild balance-calculator, config read/write, etc.), the server updates a small marker (e.g. a `.lastUsed` file or similar) in that session’s directory so we know when it was last active.

- **Rule**  
  If a workspace has been inactive for longer than a configured threshold (e.g. **2 weeks**), it is deleted (e.g. the whole `workspaces/<sessionId>/` tree). So we keep at most 2 weeks of inactivity before removing the clone and generated files for that session.

- **When cleanup runs**  
  Cleanup runs at server startup and on a schedule (e.g. once every 24 hours). Inactive workspaces beyond the threshold are removed so disk usage stays bounded while still giving returning users a reasonable time to come back and find their files.

---

## Summary

| Aspect | Choice |
|--------|--------|
| **Scope** | One workspace per session (one balance-calculator clone + one outDatas directory). |
| **Session identity** | UUID stored in the browser (e.g. `localStorage`) and sent as `X-Session-Id`. |
| **Isolation** | All generation-related APIs use session-scoped paths and, where needed, `ensureSession` (or equivalent). |
| **Generated files** | Listed, uploaded, deleted, and served only within that session; URLs include the session ID. |
| **Storage limit** | Workspaces with no activity for more than the configured period (e.g. 2 weeks) are removed automatically. |

This gives per-user (per-browser) isolation for the Generate flow and the “Fichiers générés” section, keeps behavior consistent when the same user returns in the same browser, and limits long-term storage growth.
