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

---

## Data Model

### Extended `ConnectorEntry`

```typescript
interface ConnectorEntry {
  id: string;             // "oauth/google", "remote-mcp/stripe", "mcp/my-server"
  name: string;
  description: string;
  category: string;       // NEW — "Finance", "Developer Tools", etc.
  type: "oauth" | "mcp" | "remote-mcp";  // "remote-mcp" is new
  status: "connected" | "available";
  logoSvg?: string;       // NEW — inline SVG for brand logo
  url?: string;           // NEW — pre-filled for catalog entries
  docsUrl?: string;       // NEW — link to provider's MCP docs
  requiresToken: boolean; // NEW
}
```

### Catalog

50 static entries defined in `sidecar/connectors.ts`, grouped into 10 categories:

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

Each catalog entry has: `id`, `name`, `description`, `category`, `url` (pre-filled MCP endpoint), `docsUrl`, `logoSvg`, `requiresToken`.

---

## Backend (Sidecar)

### `/api/connectors` (GET) — updated

Returns merged array in this order:
1. OAuth providers (existing)
2. Catalog entries — status resolved by checking auth storage for each `remote-mcp/<id>` key
3. Local MCP servers from `mcp.json` that don't match any catalog entry (existing)

### `POST /api/connectors/remote-mcp` — new

**Body:**
```json
{
  "id": "stripe",
  "name": "Stripe",
  "url": "https://mcp.stripe.com",
  "token": "sk_live_..."
}
```

**Actions:**
1. Validate URL (must start with `https://`)
2. Check for duplicate URL in `mcp.json` → return 409 if exists
3. Write entry to `mcp.json`: `{ "url": "...", "type": "streamable-http" }`
4. Write token to auth storage under key `remote-mcp/<id>`
5. Return updated `ConnectorEntry` with `status: "connected"`

**For custom connectors:** same endpoint, `id` is slugified from the user-provided name.

### `DELETE /api/connectors/remote-mcp/:id` — new

**Actions:**
1. Remove entry from `mcp.json` by matching name/id
2. Remove token from auth storage under key `remote-mcp/<id>`
3. Return 204

---

## Frontend (ConnectorsPage)

### Layout

```
Header:
  [Network icon] Connectors          [Search input]   [+ Custom connector btn]

Tagline:
  Connect your apps and services so the agent can access and act on your data.

Filter row:
  [All] [Connected] [Available]                       [Category dropdown ▼]

Grid: 3 columns
```

### Card States

**Available remote-mcp card (collapsed):**
- Logo, name, description, status dot "Available"
- Entire card is clickable → expands inline form

**Available remote-mcp card (expanded):**
- Logo, name, description, status dot
- Divider
- URL field (pre-filled, editable)
- Token field (password input, placeholder "Auth token")
- Cancel + Connect buttons
- Inline validation errors below fields

**Connected remote-mcp card:**
- Logo, name, description, status dot "Connected"
- Small ✕ button in top-right corner → disconnect (no confirmation)
- Not clickable for re-configuration (must disconnect first)

**Custom connector (via + button):**
- Same expanded form layout but with an additional Name field at top
- Generic icon (letter avatar) since no logo available
- After connect, appears as a connected card with user-provided name

**OAuth card:** unchanged — click opens Settings modal
**Local MCP card:** unchanged — cursor-default, always "connected", no ✕ button

### Filtering Logic

- Tab filter (All / Connected / Available) AND category dropdown AND search all apply simultaneously
- "All" in the category dropdown shows every category
- Search matches on `name` and `description`

### Brand Logos

- Inline SVG per catalog entry, rendered inside the existing `ConnectorIcon` component
- Fallback to current letter-avatar with brand color if `logoSvg` is absent

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| Empty URL | Inline error "URL is required" before API call |
| Invalid URL format | Inline error "Must be a valid https:// URL" |
| Duplicate URL | API returns 409 → inline error "A server with this URL already exists" |
| Empty name (custom) | Inline error "Name is required" |
| API error on connect | Inline error on card, form stays open |
| API error on disconnect | Revert optimistic update, show toast error |
| Connect success | Card collapses, status flips to "Connected" — no page reload |
| Disconnect success | Card returns to "Available" state — no page reload |

---

## File Changes

| File | Change |
|------|--------|
| `sidecar/connectors.ts` | Add `REMOTE_MCP_CATALOG`, extend `ConnectorEntry`, update `listConnectors()` |
| `sidecar/server.ts` | Add `POST /api/connectors/remote-mcp` and `DELETE /api/connectors/remote-mcp/:id` routes |
| `src/ConnectorsPage.tsx` | Category dropdown, 3-column grid, inline expand/collapse, logo rendering, custom connector form |
| `src/types.ts` (if exists) | Update shared `ConnectorEntry` interface |

---

## Security

- Auth tokens never stored in `mcp.json` (plaintext) — always written to OS auth storage (keychain via existing `AuthStorage` abstraction)
- `mcp.json` contains only the URL and connection type
- Token field uses `type="password"` in the UI
- URL validation enforces `https://` only
