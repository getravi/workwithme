# Remote MCP Connectors — Design Spec

**Date:** 2026-03-18
**Status:** Approved

## Overview

Add remote MCP servers as first-class connectors in the workwithme app. Users can browse a curated catalog of 50 well-known services, connect them by providing a URL and auth token (stored securely in the OS keychain), and add custom remote MCP servers manually.

## Goals

- Display a curated catalog of 50 remote MCP servers as available connectors
- Allow users to connect catalog servers via inline card expansion (pre-filled URL + token input)
- Allow users to add arbitrary custom remote MCP servers via a "+ Custom connector" button
- Store tokens securely in the OS auth storage (keychain); write URLs to `mcp.json`
- Add category filtering to the connectors page
- Upgrade to a 3-column grid with real brand logos

## Non-Goals

- Dynamic fetching from the MCP registry at runtime
- Managing tool-level configuration per MCP server
- OAuth flow for MCP servers (token must be obtained externally)
- Rate limiting, SSRF protection, or sidecar authentication (local-only app, v1 scope)
- Token rotation or expiry detection
- URL probing/health-check at connect time (no outbound call is made during POST)
- Certificate pinning (standard system TLS validation applies)
- Multi-user keychain isolation (single OS user assumed)

---

## Data Model

### Extended `ConnectorEntry`

```typescript
interface ConnectorEntry {
  id: string;
  // Format: "oauth/<provider>", "remote-mcp/<slug>", "mcp/<name>"
  // type "oauth"       — OAuth providers (Anthropic, Google, GitHub, OpenAI)
  // type "remote-mcp" — catalog entries AND user-added custom remote MCP servers
  // type "mcp"        — local stdio/command-based MCP servers from mcp.json not in catalog

  name: string;
  description: string;
  category: string;
  // One of the 10 defined categories below, or "Local" for type "mcp"

  type: "oauth" | "mcp" | "remote-mcp";
  status: "connected" | "available";
  logoSvg?: string;
  // Inline SVG string for catalog entries. Absent for custom connectors and OAuth (which use letter-avatar).

  url?: string;
  // Pre-filled for catalog entries; user-provided for custom. Not present for OAuth/local MCP.

  docsUrl?: string;
  // Surfaced as a "Get token ↗" link next to the token field in the expanded card.

  requiresToken: boolean;
  // true  → token field shown and required in connect form
  // false → token field hidden; POST may omit token
  // Custom connectors always have requiresToken: true
}
```

### Categories

The 10 defined category values (used in the dropdown filter and on catalog entries):

`Productivity` · `Google` · `Microsoft` · `Communication` · `CRM & Sales` · `Finance` · `Developer Tools` · `Database` · `E-commerce & Content` · `AI/ML`

Local MCP servers use the special category `"Local"` (shown in All view but excluded from the category dropdown).

### Catalog

50 static entries defined as a TypeScript constant array `REMOTE_MCP_CATALOG` in `sidecar/connectors.ts`. Loaded at module import time — no file I/O or runtime fetch. The catalog is part of the sidecar bundle.

| Category | Servers |
|----------|---------|
| Productivity | Atlassian, Notion, Linear, Zapier, Asana, Airtable, Monday.com, ClickUp, Trello, Coda |
| Google | Google Drive, Gmail, Google Calendar, Google Docs, Google Sheets, Google Slides, YouTube |
| Microsoft | GitHub, OneDrive, SharePoint, Microsoft Teams, Outlook |
| Communication | Slack, Discord, Zoom, Twilio |
| CRM & Sales | Salesforce, HubSpot, Intercom, Zendesk |
| Finance | Stripe, QuickBooks, Xero |
| Developer Tools | Cloudflare, Sentry, Figma, Vercel, AWS, Datadog, PagerDuty, CircleCI |
| Database | Neon, Supabase, PlanetScale, MongoDB Atlas, Firebase |
| E-commerce & Content | Shopify, WordPress, Webflow, Dropbox |
| AI/ML | Hugging Face, Replicate |

---

## Backend (Sidecar)

### `mcp.json` format

Existing file at the path resolved by `loadMcpConfig()`. Remote MCP entries are written as:
```json
{
  "mcpServers": {
    "stripe": {
      "url": "https://mcp.stripe.com",
      "type": "streamable-http"
    }
  }
}
```
The key is the connector `id` slug (e.g., `stripe`, `my-custom-server`).

### `/api/connectors` (GET) — updated

**Status resolution for catalog entries:**

When `requiresToken: true`:
- `"connected"` = id key in `mcp.json` **AND** keychain entry present
- Keychain only (no mcp.json) → `"available"`, silently delete stale keychain entry (log warning on deletion failure)
- mcp.json only (no keychain) → `"available"`, leave mcp.json entry in place

When `requiresToken: false`:
- `"connected"` = id key in `mcp.json` (keychain not checked)
- No mcp.json entry → `"available"`

**Stale reserved-slug entries in mcp.json:** if a stored entry's id matches a catalog slug, GET returns it normally as a connected catalog card. The reserved-slug rule is POST-only enforcement (prevents new writes); it does not filter or alter existing stored entries.

**Catalog matching on GET:** catalog entries are matched to `mcp.json` entries by `id` key, not by URL. This ensures a user-edited URL does not cause duplication.

**Merged response order:**
1. OAuth providers (existing, `type: "oauth"`, `category: "OAuth"`)
2. Catalog entries (`type: "remote-mcp"`, status as above)
3. Local `mcp.json` servers whose key does not match any catalog `id` (`type: "mcp"`, `category: "Local"`, always `status: "connected"`)

**Failure handling:**
- `mcp.json` missing or malformed → log warning, return empty local MCP section, rest of response unaffected
- Keychain read failure → log warning, treat all catalog entries as `"available"`, return response with a top-level `warning` field: `"Could not read credentials store"`
- If the sidecar itself is unreachable, the frontend shows: "Could not load connectors. Is the sidecar running?" with a Retry button

### `POST /api/connectors/remote-mcp` — new

**Note on `id` format:** The `id` in the POST body is the **slug only** (e.g., `stripe`), not the prefixed `ConnectorEntry.id` (e.g., `remote-mcp/stripe`). The sidecar prepends `remote-mcp/` internally when constructing the response object and the keychain account name.

**Request body:**
```typescript
{
  id: string;      // slug only: "stripe", "my-custom-server" (no "remote-mcp/" prefix)
  name: string;    // human-readable name, written to mcp.json
  url: string;
  token?: string;  // see requiresToken rules below
}
```

**`requiresToken` resolution:** The backend determines `requiresToken` by looking up `id` in `REMOTE_MCP_CATALOG`. If found, use the catalog entry's value. If not found (custom connector), `requiresToken` is `true`. The client does NOT send `requiresToken` in the POST body.

**Reserved slugs:** All catalog entry slugs are reserved. If a custom connector POST sends an `id` that matches a catalog slug, the backend returns 400 "This name is reserved for a catalog connector."

**Validation (all checked before any writes; returns 400 with field-level errors):**
1. `id` must match `/^[a-z0-9][a-z0-9-]{0,62}$/`
2. `id` must not match any catalog slug → 400 "This name is reserved for a catalog connector."
3. `url` required, must start with `https://` (case-insensitive), max 2048 chars, trimmed
4. `name` required, max 64 chars, trimmed
5. `token` required if `requiresToken` is `true`. Missing token → 400 "Auth token is required". If `requiresToken: false` and token is provided, it is silently ignored.

**Status values defined:**
- `"connected"`:
  - When `requiresToken: true` — id key present in `mcp.json` **AND** keychain entry present
  - When `requiresToken: false` — id key present in `mcp.json` (no keychain entry expected or required)
- `"available"` — all other states

**Duplicate URL check scope:** checks only the stored entries in `mcp.json` (both catalog-connected and custom entries already written). Does not check catalog default URLs that have not been connected yet.

**Actions write order (explicit):**
1. Check: does `id` already exist as a key in `mcp.json`? → 409 "A connector with this name already exists" *(id check runs first)*
2. Check: does `url` (trimmed, lowercased) already exist as a url value in `mcp.json`? → 409 "A server with this URL already exists" *(url check runs second; if both dup conditions are true, id 409 is returned)*
3. Write entry to `mcp.json` under key `id`. If write fails → return 500 "Failed to save server. Please try again." (no keychain write attempted; no rollback needed — mcp.json was not modified)
4. If `requiresToken: true`: write token to keychain (`service: workwithme`, `account: remote-mcp/<id>`)
5. If step 3 succeeds but step 4 fails → attempt to rollback step 3 (remove `id` from `mcp.json`). Whether rollback succeeds or fails, return 500 "Failed to save credentials. Your connection was not saved." If rollback fails, log a warning — GET will self-heal to `status: "available"` on next load.
6. Return the full `ConnectorEntry` with `status: "connected"`. **The token is never included in the response body.**

**Request timeout:** The frontend sets a 30-second timeout on POST/DELETE. On timeout: "Request timed out. Please try again."

**Custom connectors:** `requiresToken` is always `true`. The `id` slug is generated on the frontend:
- Lowercase the name, replace spaces and non-alphanumeric chars with `-`, collapse consecutive dashes, truncate to 63 chars
- If the slug collides with any existing connector id in the current GET response, append `-2`, incrementing until unique. Maximum custom connectors: 200 (frontend enforces by disabling the `+ Custom connector` button and showing "Maximum number of custom connectors reached" when 200 custom connectors exist). The `-99` per-base-name limit is a soft guard; the 200 total limit is the hard cap.

### `DELETE /api/connectors/remote-mcp/:id` — new

**Validation:** `id` must match `/^[a-z0-9][a-z0-9-]{0,62}$/` → 400 otherwise.

**Actions:**
1. Attempt to remove entry from `mcp.json` by key `id`
2. Attempt to remove keychain entry `workwithme / remote-mcp/<id>`
3. If `id` not found in `mcp.json` AND not found in keychain → 404
4. If `id` found in only one → proceed, removing what exists (partial cleanup is acceptable)
5. If `mcp.json` removal succeeds but keychain removal fails → log warning, return 204 (stale keychain entry cleaned up on next GET)
6. Return 204

---

## Frontend (ConnectorsPage)

### Layout

```
Header:
  [Network icon] Connectors     [Search input]    [+ Custom connector btn]

Tagline:
  Connect your apps and services so the agent can access and act on your data.

Filter row:
  [All] [Connected] [Available]          [Category: All ▼]

Grid: 3 columns (was 2)
```

### Filtering

AND logic across all three dimensions:
- **Tab**: All / Connected / Available (filters on `status`)
- **Category dropdown**: All (default) or one of the 10 named categories. "All" includes `"Local"` category. Dropdown does not show `"Local"` as a selectable option — local servers appear only under "All".
- **Search**: case-insensitive substring on `name` and `description`. Applies to all connector types (catalog, custom, OAuth, local).

### Card States

**Available remote-mcp card (collapsed):**
- `<ConnectorLogo>` (brand SVG or letter-avatar fallback), name, description, `● Available`
- Entire card is clickable → expands inline
- Only **one card** can be expanded at a time; clicking any other card (or a second click on the same) collapses the open one

**Available remote-mcp card (expanded):**
- Same header as collapsed (logo, name, description, status dot)
- Thin divider
- URL field: pre-filled (catalog) or empty (custom); always editable; label "Server URL"
- Token field: shown only when `requiresToken: true`; `type="password"`; label "Auth token"; placeholder "Paste your token here"
- If `docsUrl` set: small `"Get token ↗"` link to the right of the token label; opens in system browser
- Inline validation errors rendered in red directly below the relevant field
- `[Cancel]` (collapses card, clears inputs) + `[Connect]` button
- `[Connect]` shows a spinner and is disabled while the API request is in-flight

**Connected remote-mcp card:**
- Logo, name, description, `● Connected`
- Small `✕` icon button in the top-right corner
- On `✕` click: **optimistic update** — immediately flip card to `status: "available"` (collapsed), then fire `DELETE` in background; if DELETE fails, flip card back to `status: "connected"` and show an inline error below the card: `"Disconnect failed. Please try again."`
- Card is not clickable for re-configuration; user must disconnect first

**Custom connector panel (via `+` button in header):**
- Opens as an inline panel **above the grid** (not a modal, not a card)
- Fields: Name (required, max 64 chars), Server URL (required, https://), Auth token (required, password)
- `[Cancel]` closes the panel; `[Add connector]` submits
- After success: panel closes, new connected card appears at the top of the grid
- Error display: inline below the relevant field
- When the custom connector panel is open, any expanded catalog card is collapsed first
- If the user navigates away from ConnectorsPage while the panel is open, it is dismissed without saving (no persistence of panel state across navigation)
- `docsUrl` links open via the Tauri `open()` shell API (system default browser); not applicable on the custom panel

**OAuth cards:** unchanged — clickable, opens Settings modal
**Local MCP cards:** unchanged — `cursor-default`, always `status: "connected"`, no `✕` button

### `<ConnectorLogo>` component

Replaces `<ConnectorIcon>`. Renders `logoSvg` inline when present; falls back to the current letter-avatar (first letter of `name`, uppercased) with brand color from `ICON_COLORS`.

### GET response `warning` field

When a non-fatal warning occurs on GET (e.g., keychain read failure), the response includes a top-level `warning` string field alongside the `connectors` array:
```json
{
  "connectors": [...],
  "warning": "Could not read credentials store. Some connectors may show as available."
}
```
When no warning, the field is absent (not null). The frontend renders this as a dismissible banner above the grid when present.

### `GET /api/connectors` failure

If the fetch fails, times out, or returns a non-2xx response, the page shows a centred error message: "Could not load connectors." with a Retry button that re-fires the fetch. A 30-second timeout applies.

---

## Error Handling

**Inline errors** are displayed in red `text-[11px]` below the relevant field (or below the form if not field-specific). They do not use toasts. They are cleared when the user modifies the relevant field or clicks Cancel.

| Scenario | HTTP | UI Behaviour |
|----------|------|--------------|
| Empty URL | — | Inline error "Server URL is required" |
| URL not https:// | — | Inline error "Must be a valid https:// URL" |
| URL too long (>2048) | — | Inline error "URL is too long" |
| Empty name | — | Inline error "Name is required" |
| Name too long | — | Inline error "Name must be 64 characters or fewer" |
| Missing token (required) | — | Inline error "Auth token is required" |
| Duplicate id | 409 | Inline error "A connector with this name already exists" |
| Duplicate URL | 409 | Inline error "A server with this URL already exists" |
| Invalid id chars | 400 | Inline error "Invalid server name" |
| Keychain write failure | 500 | Inline error "Failed to save credentials. Your connection was not saved." |
| mcp.json write failure | 500 | Inline error "Failed to save server. Please try again." |
| Other API error on connect | 5xx | Inline error "Something went wrong. Please try again." |
| Too many duplicate slugs | — | Inline error "Too many connectors with similar names" |
| Disconnect API failure | any | Revert optimistic update; inline error below card "Disconnect failed. Please try again." |
| Keychain access denied (GET) | — | Connectors load with `warning` banner: "Could not read credentials store. Some connectors may show as available." |
| GET fails entirely | — | Error state with Retry button |
| DELETE id not found | 404 | UI treats as success (already disconnected) |
| POST/DELETE network timeout | — | Inline "Request timed out. Please try again." |
| GET network timeout | — | Error state + Retry button |

---

## File Changes

| File | Change |
|------|--------|
| `sidecar/connectors.ts` | Add `REMOTE_MCP_CATALOG` constant (50 entries), extend `ConnectorEntry` interface, update `listConnectors()` with new merge logic |
| `sidecar/server.ts` | Add `POST /api/connectors/remote-mcp` and `DELETE /api/connectors/remote-mcp/:id` routes |
| `src/ConnectorsPage.tsx` | Category dropdown, 3-column grid, inline expand/collapse, `<ConnectorLogo>`, custom connector panel, optimistic disconnect, error states |

---

## Security Notes (v1 scope)

- Tokens never written to `mcp.json` — always stored in OS auth storage
- Tokens never logged — sidecar must scrub token values from any error log lines
- Keychain: service `workwithme`, account `remote-mcp/<id>`
- Token field `type="password"` in UI
- URL validation enforces `https://` only, max 2048 chars
- ID validated with `/^[a-z0-9][a-z0-9-]{0,62}$/` to prevent path traversal
- Token values must not appear in API error response bodies
- No outbound HTTP call is made to the MCP server URL at connect time
- Standard system TLS certificate validation applies to all outbound MCP connections
- SSRF protection and sidecar authentication deferred to a future version
