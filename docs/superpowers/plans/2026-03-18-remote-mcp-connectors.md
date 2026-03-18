# Remote MCP Connectors Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add remote MCP servers as first-class connectors — a 50-entry catalog, inline connect/disconnect UI, OS keychain token storage, and a custom connector panel.

**Architecture:** Extend `sidecar/connectors.ts` with catalog data, keychain helpers, and write/delete business logic; add two new routes to `sidecar/server.ts`; overhaul `src/ConnectorsPage.tsx` with expanded card states, category filtering, 3-column grid, and a custom connector panel.

**Tech Stack:** Node.js/TypeScript (sidecar), `keytar` (OS keychain), `pi-mcp-adapter/config` (mcp.json read), custom atomic writer for mcp.json writes, React/Tailwind (frontend), `@tauri-apps/plugin-opener` (external URL links).

---

## Chunk 1: Sidecar data layer

### Task 1: Add keytar dependency

**Files:**
- Modify: `sidecar/package.json`

- [ ] **Step 1: Add keytar to sidecar dependencies**

```bash
cd sidecar && pnpm add keytar
```

- [ ] **Step 2: Verify install**

```bash
cd sidecar && node -e "import('keytar').then(k => console.log('ok', typeof k.default.getPassword))"
```

Expected: `ok function`

- [ ] **Step 3: Commit**

```bash
git add sidecar/package.json sidecar/pnpm-lock.yaml
git commit -m "chore: add keytar for OS keychain access"
```

---

### Task 2: Extend ConnectorEntry interface and add catalog

**Files:**
- Modify: `sidecar/connectors.ts`
- Modify: `sidecar/connectors.test.ts`

- [ ] **Step 1: Write failing tests for catalog shape**

Add to `sidecar/connectors.test.ts`:

```typescript
import { REMOTE_MCP_CATALOG, CATALOG_SLUGS } from './connectors.js';

describe('REMOTE_MCP_CATALOG', () => {
  it('has at least 50 entries', () => {
    expect(REMOTE_MCP_CATALOG.length).toBeGreaterThanOrEqual(50);
  });

  it('every entry has required fields', () => {
    for (const entry of REMOTE_MCP_CATALOG) {
      expect(typeof entry.slug).toBe('string');
      expect(entry.slug).toMatch(/^[a-z0-9][a-z0-9-]{0,62}$/);
      expect(typeof entry.name).toBe('string');
      expect(typeof entry.category).toBe('string');
      expect(typeof entry.requiresToken).toBe('boolean');
    }
  });

  it('CATALOG_SLUGS is a Set of all catalog slugs', () => {
    expect(CATALOG_SLUGS.size).toBe(REMOTE_MCP_CATALOG.length);
    for (const entry of REMOTE_MCP_CATALOG) {
      expect(CATALOG_SLUGS.has(entry.slug)).toBe(true);
    }
  });

  it('all slugs are unique', () => {
    const slugs = REMOTE_MCP_CATALOG.map(e => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd sidecar && pnpm test -- --reporter=verbose 2>&1 | grep -A5 "REMOTE_MCP_CATALOG"
```

Expected: FAIL — `REMOTE_MCP_CATALOG is not exported`

- [ ] **Step 3: Update ConnectorEntry interface and add catalog to connectors.ts**

Replace the top of `sidecar/connectors.ts` with:

```typescript
import { getOAuthProviders } from '@mariozechner/pi-ai/oauth';
import { loadMcpConfig } from 'pi-mcp-adapter/config';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';

export interface ConnectorEntry {
  id: string;
  // Full prefixed id: "oauth/<provider>", "remote-mcp/<slug>", "mcp/<name>"
  name: string;
  description: string;
  category: string;
  type: 'oauth' | 'mcp' | 'remote-mcp';
  status: 'connected' | 'available';
  logoSvg?: string;
  url?: string;
  docsUrl?: string;
  requiresToken: boolean;
}

export interface CatalogEntry {
  slug: string;      // e.g. "stripe"
  name: string;
  description: string;
  category: string;
  url: string;
  docsUrl?: string;
  requiresToken: boolean;
  logoSvg?: string;
}

export const REMOTE_MCP_CATALOG: CatalogEntry[] = [
  // Productivity
  {
    slug: 'atlassian',
    name: 'Atlassian',
    description: 'Jira, Confluence, and Trello project management',
    category: 'Productivity',
    url: 'https://mcp.atlassian.com/v1/mcp',
    docsUrl: 'https://developer.atlassian.com/cloud/jira/platform/mcp/',
    requiresToken: true,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.53 2.23c-.17-.24-.52-.24-.69 0L.16 18.96c-.17.24.01.54.34.54h6.93a.74.74 0 0 0 .63-.35l3.47-5.61 3.47 5.61c.13.21.36.35.63.35h6.93c.33 0 .51-.3.34-.54L12.22 2.23a.38.38 0 0 0-.69 0Z" fill="#0052CC"/></svg>`,
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Docs, wikis, and project management',
    category: 'Productivity',
    url: 'https://mcp.notion.com/v1',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    requiresToken: true,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" fill="#000"/></svg>`,
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Issue tracking and project management',
    category: 'Productivity',
    url: 'https://mcp.linear.app/sse',
    docsUrl: 'https://linear.app/docs/mcp',
    requiresToken: true,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2.07 13.5l8.43 8.43A10 10 0 0 1 2.07 13.5zm-.03-2.06a10 10 0 0 0 10.52 10.52L2.04 11.44zM22 12a10 10 0 0 0-9.95-10L22 12zm-10 10a10 10 0 0 0 10-10L12 22zM3.22 9.1l11.68 11.68a10.09 10.09 0 0 0 1.57-.87L4.09 7.53A10.09 10.09 0 0 0 3.22 9.1zm2.56-3.85L20.75 20.22a10 10 0 0 0 1.08-1.32L6.9 4.17A10 10 0 0 0 5.78 5.25zM8.73 3.1l12.17 12.17a10 10 0 0 0 .52-1.64L10.37 2.58A10 10 0 0 0 8.73 3.1z" fill="#5E6AD2"/></svg>`,
  },
  {
    slug: 'zapier',
    name: 'Zapier',
    description: 'Workflow automation across 5000+ apps',
    category: 'Productivity',
    url: 'https://mcp.zapier.com/v1',
    docsUrl: 'https://zapier.com/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'asana',
    name: 'Asana',
    description: 'Work management and team collaboration',
    category: 'Productivity',
    url: 'https://mcp.asana.com/v1',
    docsUrl: 'https://developers.asana.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Database and spreadsheet hybrid',
    category: 'Productivity',
    url: 'https://mcp.airtable.com/v1',
    docsUrl: 'https://airtable.com/developers/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'monday',
    name: 'Monday.com',
    description: 'Work OS for teams',
    category: 'Productivity',
    url: 'https://mcp.monday.com/v1',
    docsUrl: 'https://developer.monday.com/apps/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    description: 'Productivity platform with tasks and docs',
    category: 'Productivity',
    url: 'https://mcp.clickup.com/v1',
    docsUrl: 'https://clickup.com/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'trello',
    name: 'Trello',
    description: 'Visual project boards by Atlassian',
    category: 'Productivity',
    url: 'https://mcp.trello.com/v1',
    docsUrl: 'https://developer.atlassian.com/cloud/trello/mcp/',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'coda',
    name: 'Coda',
    description: 'Docs that work like apps',
    category: 'Productivity',
    url: 'https://mcp.coda.io/v1',
    docsUrl: 'https://coda.io/developers/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // Google
  {
    slug: 'google-drive',
    name: 'Google Drive',
    description: 'Cloud file storage and collaboration',
    category: 'Google',
    url: 'https://mcp.googleapis.com/drive/v1',
    docsUrl: 'https://developers.google.com/drive/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Email service by Google',
    category: 'Google',
    url: 'https://mcp.googleapis.com/gmail/v1',
    docsUrl: 'https://developers.google.com/gmail/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    description: 'Calendar and scheduling by Google',
    category: 'Google',
    url: 'https://mcp.googleapis.com/calendar/v1',
    docsUrl: 'https://developers.google.com/calendar/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'google-docs',
    name: 'Google Docs',
    description: 'Collaborative document editing',
    category: 'Google',
    url: 'https://mcp.googleapis.com/docs/v1',
    docsUrl: 'https://developers.google.com/docs/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    description: 'Spreadsheets in the cloud',
    category: 'Google',
    url: 'https://mcp.googleapis.com/sheets/v1',
    docsUrl: 'https://developers.google.com/sheets/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'google-slides',
    name: 'Google Slides',
    description: 'Presentation software by Google',
    category: 'Google',
    url: 'https://mcp.googleapis.com/slides/v1',
    docsUrl: 'https://developers.google.com/slides/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    description: 'Video platform by Google',
    category: 'Google',
    url: 'https://mcp.googleapis.com/youtube/v1',
    docsUrl: 'https://developers.google.com/youtube/v3/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // Microsoft
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Code hosting and collaboration',
    category: 'Microsoft',
    url: 'https://api.githubcopilot.com/mcp/v1',
    docsUrl: 'https://docs.github.com/en/copilot/mcp',
    requiresToken: true,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="#181717"/></svg>`,
  },
  {
    slug: 'onedrive',
    name: 'OneDrive',
    description: 'Cloud storage by Microsoft',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/onedrive/v1',
    docsUrl: 'https://docs.microsoft.com/graph/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'sharepoint',
    name: 'SharePoint',
    description: 'Collaboration platform by Microsoft',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/sharepoint/v1',
    docsUrl: 'https://docs.microsoft.com/sharepoint/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'teams',
    name: 'Microsoft Teams',
    description: 'Communication and collaboration hub',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/teams/v1',
    docsUrl: 'https://docs.microsoft.com/teams/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    description: 'Email and calendar by Microsoft',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/outlook/v1',
    docsUrl: 'https://docs.microsoft.com/outlook/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // Communication
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Team messaging and collaboration',
    category: 'Communication',
    url: 'https://mcp.slack.com/v1',
    docsUrl: 'https://api.slack.com/mcp',
    requiresToken: true,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#4A154B"/></svg>`,
  },
  {
    slug: 'discord',
    name: 'Discord',
    description: 'Voice, video, and text communication',
    category: 'Communication',
    url: 'https://mcp.discord.com/v1',
    docsUrl: 'https://discord.com/developers/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'zoom',
    name: 'Zoom',
    description: 'Video conferencing and meetings',
    category: 'Communication',
    url: 'https://mcp.zoom.us/v1',
    docsUrl: 'https://developers.zoom.us/docs/api/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'twilio',
    name: 'Twilio',
    description: 'SMS, voice, and messaging APIs',
    category: 'Communication',
    url: 'https://mcp.twilio.com/v1',
    docsUrl: 'https://www.twilio.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // CRM & Sales
  {
    slug: 'salesforce',
    name: 'Salesforce',
    description: 'CRM and customer data platform',
    category: 'CRM & Sales',
    url: 'https://mcp.salesforce.com/v1',
    docsUrl: 'https://developer.salesforce.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'CRM, marketing, and sales platform',
    category: 'CRM & Sales',
    url: 'https://mcp.hubspot.com/v1',
    docsUrl: 'https://developers.hubspot.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    description: 'Customer messaging platform',
    category: 'CRM & Sales',
    url: 'https://mcp.intercom.com/v1',
    docsUrl: 'https://developers.intercom.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Customer support and ticketing',
    category: 'CRM & Sales',
    url: 'https://mcp.zendesk.com/v1',
    docsUrl: 'https://developer.zendesk.com/api-reference/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // Finance
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Payment processing and billing',
    category: 'Finance',
    url: 'https://mcp.stripe.com',
    docsUrl: 'https://docs.stripe.com/stripe-apps/mcp',
    requiresToken: true,
    logoSvg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" fill="#6772E5"/></svg>`,
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    description: 'Accounting software by Intuit',
    category: 'Finance',
    url: 'https://mcp.intuit.com/quickbooks/v1',
    docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'xero',
    name: 'Xero',
    description: 'Cloud accounting platform',
    category: 'Finance',
    url: 'https://mcp.xero.com/v1',
    docsUrl: 'https://developer.xero.com/documentation/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // Developer Tools
  {
    slug: 'cloudflare',
    name: 'Cloudflare',
    description: 'CDN, security, and edge computing',
    category: 'Developer Tools',
    url: 'https://mcp.cloudflare.com/v1',
    docsUrl: 'https://developers.cloudflare.com/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Error tracking and performance monitoring',
    category: 'Developer Tools',
    url: 'https://mcp.sentry.io/v1',
    docsUrl: 'https://docs.sentry.io/product/integrations/mcp/',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'figma',
    name: 'Figma',
    description: 'Collaborative design tool',
    category: 'Developer Tools',
    url: 'https://mcp.figma.com/v1',
    docsUrl: 'https://www.figma.com/developers/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    description: 'Frontend deployment and hosting',
    category: 'Developer Tools',
    url: 'https://mcp.vercel.com/v1',
    docsUrl: 'https://vercel.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'aws',
    name: 'AWS',
    description: 'Amazon Web Services cloud platform',
    category: 'Developer Tools',
    url: 'https://mcp.amazonaws.com/v1',
    docsUrl: 'https://docs.aws.amazon.com/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'datadog',
    name: 'Datadog',
    description: 'Monitoring and analytics platform',
    category: 'Developer Tools',
    url: 'https://mcp.datadoghq.com/v1',
    docsUrl: 'https://docs.datadoghq.com/developers/mcp/',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'pagerduty',
    name: 'PagerDuty',
    description: 'Incident management and alerting',
    category: 'Developer Tools',
    url: 'https://mcp.pagerduty.com/v1',
    docsUrl: 'https://developer.pagerduty.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'circleci',
    name: 'CircleCI',
    description: 'Continuous integration and delivery',
    category: 'Developer Tools',
    url: 'https://mcp.circleci.com/v1',
    docsUrl: 'https://circleci.com/docs/api/v2/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // Database
  {
    slug: 'neon',
    name: 'Neon',
    description: 'Serverless Postgres database',
    category: 'Database',
    url: 'https://mcp.neon.tech/v1',
    docsUrl: 'https://neon.tech/docs/ai/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'Open source Firebase alternative',
    category: 'Database',
    url: 'https://mcp.supabase.com/v1',
    docsUrl: 'https://supabase.com/docs/guides/ai/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'planetscale',
    name: 'PlanetScale',
    description: 'Serverless MySQL database platform',
    category: 'Database',
    url: 'https://mcp.planetscale.com/v1',
    docsUrl: 'https://planetscale.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    description: 'Cloud database service by MongoDB',
    category: 'Database',
    url: 'https://mcp.mongodb.com/atlas/v1',
    docsUrl: 'https://www.mongodb.com/docs/atlas/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'firebase',
    name: 'Firebase',
    description: 'App development platform by Google',
    category: 'Database',
    url: 'https://mcp.firebase.google.com/v1',
    docsUrl: 'https://firebase.google.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // E-commerce & Content
  {
    slug: 'shopify',
    name: 'Shopify',
    description: 'E-commerce platform',
    category: 'E-commerce & Content',
    url: 'https://mcp.shopify.com/v1',
    docsUrl: 'https://shopify.dev/docs/apps/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'wordpress',
    name: 'WordPress',
    description: 'CMS and website builder',
    category: 'E-commerce & Content',
    url: 'https://mcp.wordpress.com/v1',
    docsUrl: 'https://developer.wordpress.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'webflow',
    name: 'Webflow',
    description: 'No-code website builder',
    category: 'E-commerce & Content',
    url: 'https://mcp.webflow.com/v1',
    docsUrl: 'https://developers.webflow.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'dropbox',
    name: 'Dropbox',
    description: 'Cloud storage and file sharing',
    category: 'E-commerce & Content',
    url: 'https://mcp.dropbox.com/v1',
    docsUrl: 'https://www.dropbox.com/developers/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  // AI/ML
  {
    slug: 'hugging-face',
    name: 'Hugging Face',
    description: 'AI models and datasets hub',
    category: 'AI/ML',
    url: 'https://mcp.huggingface.co/v1',
    docsUrl: 'https://huggingface.co/docs/hub/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
  {
    slug: 'replicate',
    name: 'Replicate',
    description: 'Run AI models in the cloud',
    category: 'AI/ML',
    url: 'https://mcp.replicate.com/v1',
    docsUrl: 'https://replicate.com/docs/mcp',
    requiresToken: true,
    logoSvg: undefined,
  },
];

export const CATALOG_SLUGS: Set<string> = new Set(REMOTE_MCP_CATALOG.map(e => e.slug));
```

- [ ] **Step 4: Fill in missing logoSvg values for all catalog entries**

For each entry with `logoSvg: undefined`, source the SVG from [Simple Icons](https://simpleicons.org/). Pattern: `viewBox="0 0 24 24"`, single `<path>` element with `fill="#HEXCOLOR"`. Example sourcing workflow:

```
1. Visit https://simpleicons.org/?q=<name>
2. Copy the SVG path (the <path d="..."> content)
3. Note the hex color from the brand guidelines tab
4. Replace logoSvg: undefined with the inline SVG string matching the Atlassian/Slack/GitHub examples above
```

Entries to fill in (46 total): Zapier, Asana, Airtable, Monday.com, ClickUp, Trello, Coda, Google Drive, Gmail, Google Calendar, Google Docs, Google Sheets, Google Slides, YouTube, OneDrive, SharePoint, Microsoft Teams, Outlook, Discord, Zoom, Twilio, Salesforce, HubSpot, Intercom, Zendesk, QuickBooks, Xero, Cloudflare, Sentry, Figma, Vercel, AWS, Datadog, PagerDuty, CircleCI, Neon, Supabase, PlanetScale, MongoDB Atlas, Firebase, Shopify, WordPress, Webflow, Dropbox, Hugging Face, Replicate.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd sidecar && pnpm test -- --reporter=verbose 2>&1 | grep -A5 "REMOTE_MCP_CATALOG"
```

Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add sidecar/connectors.ts sidecar/connectors.test.ts
git commit -m "feat: add ConnectorEntry v2 interface and REMOTE_MCP_CATALOG (50 entries)"
```

---

### Task 3: Keychain and mcp.json helpers

**Files:**
- Modify: `sidecar/connectors.ts`
- Modify: `sidecar/connectors.test.ts`

- [ ] **Step 1: Write failing tests for helpers**

Add to `sidecar/connectors.test.ts`:

```typescript
import keytar from 'keytar';
vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(),
    setPassword: vi.fn(),
    deletePassword: vi.fn(),
  },
}));

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  keychainGet,
  keychainSet,
  keychainDelete,
  readRawMcpConfig,
  writeMcpEntry,
  removeMcpEntry,
} from './connectors.js';

const MCP_PATH = join(homedir(), '.pi', 'agent', 'mcp.json');

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

describe('keychainGet', () => {
  it('calls keytar.getPassword with correct service and account', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValueOnce('mytoken');
    const result = await keychainGet('stripe');
    expect(keytar.getPassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe');
    expect(result).toBe('mytoken');
  });

  it('returns null if not found', async () => {
    vi.mocked(keytar.getPassword).mockResolvedValueOnce(null);
    expect(await keychainGet('stripe')).toBeNull();
  });
});

describe('keychainSet', () => {
  it('calls keytar.setPassword with correct args', async () => {
    vi.mocked(keytar.setPassword).mockResolvedValueOnce();
    await keychainSet('stripe', 'tok_secret');
    expect(keytar.setPassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe', 'tok_secret');
  });
});

describe('keychainDelete', () => {
  it('calls keytar.deletePassword and returns boolean result', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValueOnce(true);
    const result = await keychainDelete('stripe');
    expect(keytar.deletePassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe');
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd sidecar && pnpm test -- --reporter=verbose 2>&1 | grep -A3 "keychainGet\|keychainSet\|keychainDelete"
```

Expected: FAIL — functions not exported

- [ ] **Step 3: Implement keychain helpers and mcp.json helpers in connectors.ts**

Add after the catalog constant:

```typescript
import keytar from 'keytar';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

const KEYCHAIN_SERVICE = 'workwithme';
// Same path as pi-mcp-adapter's DEFAULT_CONFIG_PATH — both target ~/.pi/agent/mcp.json.
// pi-mcp-adapter does not export this constant so we duplicate it here intentionally.
const MCP_CONFIG_PATH = join(homedir(), '.pi', 'agent', 'mcp.json');

// ── Keychain helpers ─────────────────────────────────────────────────────────

export async function keychainGet(slug: string): Promise<string | null> {
  return keytar.getPassword(KEYCHAIN_SERVICE, `remote-mcp/${slug}`);
}

export async function keychainSet(slug: string, token: string): Promise<void> {
  return keytar.setPassword(KEYCHAIN_SERVICE, `remote-mcp/${slug}`, token);
}

export async function keychainDelete(slug: string): Promise<boolean> {
  return keytar.deletePassword(KEYCHAIN_SERVICE, `remote-mcp/${slug}`);
}

// ── mcp.json helpers ─────────────────────────────────────────────────────────

/** Reads the raw mcpServers object from mcp.json. Returns {} if missing/malformed. */
export function readRawMcpConfig(): Record<string, unknown> {
  if (!existsSync(MCP_CONFIG_PATH)) return {};
  try {
    const raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const servers = raw.mcpServers;
      if (servers && typeof servers === 'object' && !Array.isArray(servers)) {
        return servers as Record<string, unknown>;
      }
    }
  } catch {
    // malformed — treat as empty
  }
  return {};
}

/** Atomically adds or updates a key in mcpServers in mcp.json. */
export function writeMcpEntry(slug: string, url: string): void {
  let raw: Record<string, unknown> = {};
  if (existsSync(MCP_CONFIG_PATH)) {
    try {
      raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
      if (!raw || typeof raw !== 'object') raw = {};
    } catch { raw = {}; }
  }
  const servers = (raw.mcpServers ?? {}) as Record<string, unknown>;
  servers[slug] = { url, type: 'streamable-http' };
  raw.mcpServers = servers;
  mkdirSync(dirname(MCP_CONFIG_PATH), { recursive: true });
  const tmp = `${MCP_CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
  renameSync(tmp, MCP_CONFIG_PATH);
}

/** Atomically removes a key from mcpServers in mcp.json. Returns false if key not found. */
export function removeMcpEntry(slug: string): boolean {
  if (!existsSync(MCP_CONFIG_PATH)) return false;
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(readFileSync(MCP_CONFIG_PATH, 'utf-8'));
    if (!raw || typeof raw !== 'object') return false;
  } catch { return false; }
  const servers = (raw.mcpServers ?? {}) as Record<string, unknown>;
  if (!(slug in servers)) return false;
  delete servers[slug];
  raw.mcpServers = servers;
  const tmp = `${MCP_CONFIG_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
  renameSync(tmp, MCP_CONFIG_PATH);
  return true;
}
```

- [ ] **Step 4: Run tests**

```bash
cd sidecar && pnpm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL|keychain|mcp"
```

Expected: all keychain tests PASS

- [ ] **Step 5: Commit**

```bash
git add sidecar/connectors.ts sidecar/connectors.test.ts
git commit -m "feat: add keychain helpers and mcp.json write/delete helpers"
```

---

### Task 4: Update listConnectors with catalog merge and GET response shape

**Files:**
- Modify: `sidecar/connectors.ts`
- Modify: `sidecar/connectors.test.ts`

- [ ] **Step 1: Write failing tests for updated listConnectors**

Add to `sidecar/connectors.test.ts`, replacing the existing `listConnectors` describe block:

```typescript
describe('listConnectors (updated)', () => {
  beforeEach(() => {
    vi.mocked(keytar.getPassword).mockResolvedValue(null);
    mockLoadMcpConfig.mockReturnValue({ mcpServers: {} });
  });

  it('returns { connectors, warning? } shape', async () => {
    const mockAuth = { list: () => [] } as any;
    const result = await listConnectors(mockAuth);
    expect(result).toHaveProperty('connectors');
    expect(Array.isArray(result.connectors)).toBe(true);
  });

  it('includes all catalog entries as type remote-mcp', async () => {
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const remoteMcp = connectors.filter(c => c.type === 'remote-mcp');
    expect(remoteMcp.length).toBe(REMOTE_MCP_CATALOG.length);
  });

  it('catalog entry is available when not in mcp.json', async () => {
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('available');
  });

  it('catalog entry is available and stale keychain entry is deleted when keychain-only (no mcp.json)', async () => {
    // mcp.json empty, but keychain has a stale entry → available + keychain deletion attempted
    mockLoadMcpConfig.mockReturnValue({ mcpServers: {} });
    vi.mocked(keytar.getPassword).mockImplementation(async (_svc, account) =>
      account === 'remote-mcp/stripe' ? 'stale_token' : null
    );
    vi.mocked(keytar.deletePassword).mockResolvedValue(true);
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('available');
    // Give microtask queue a tick for the fire-and-forget deletePassword call
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(keytar.deletePassword).toHaveBeenCalledWith('workwithme', 'remote-mcp/stripe');
  });

  it('catalog entry is connected when in mcp.json AND keychain has token (requiresToken=true)', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { stripe: { url: 'https://mcp.stripe.com', type: 'streamable-http' } } });
    vi.mocked(keytar.getPassword).mockImplementation(async (_svc, account) =>
      account === 'remote-mcp/stripe' ? 'tok_123' : null
    );
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('connected');
  });

  it('catalog entry is available when in mcp.json but no keychain token (requiresToken=true)', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { stripe: { url: 'https://mcp.stripe.com', type: 'streamable-http' } } });
    vi.mocked(keytar.getPassword).mockResolvedValue(null);
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const stripe = connectors.find(c => c.id === 'remote-mcp/stripe');
    expect(stripe?.status).toBe('available');
  });

  it('response order: oauth first, then remote-mcp catalog, then local mcp', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { mylocal: { command: 'node', args: ['server.js'] } } });
    const mockAuth = { list: () => ['anthropic'] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const types = connectors.map(c => c.type);
    const firstOAuth = types.indexOf('oauth');
    const firstRemote = types.indexOf('remote-mcp');
    const firstLocal = types.indexOf('mcp');
    expect(firstOAuth).toBeLessThan(firstRemote);
    expect(firstRemote).toBeLessThan(firstLocal);
  });

  it('local mcp entries whose slug matches catalog id are not added as local', async () => {
    // "stripe" is a catalog slug — should not appear as type:mcp
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { stripe: { url: 'https://mcp.stripe.com', type: 'streamable-http' } } });
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const localStripe = connectors.find(c => c.type === 'mcp' && c.id === 'mcp/stripe');
    expect(localStripe).toBeUndefined();
  });

  it('returns warning field when keychain read fails', async () => {
    vi.mocked(keytar.getPassword).mockRejectedValue(new Error('keychain locked'));
    const mockAuth = { list: () => [] } as any;
    const { connectors, warning } = await listConnectors(mockAuth);
    expect(warning).toBeTruthy();
    expect(connectors.every(c => c.type !== 'remote-mcp' || c.status === 'available')).toBe(true);
  });

  it('local mcp entries have category Local', async () => {
    mockLoadMcpConfig.mockReturnValue({ mcpServers: { mylocal: { command: 'node', args: ['server.js'] } } });
    const mockAuth = { list: () => [] } as any;
    const { connectors } = await listConnectors(mockAuth);
    const local = connectors.find(c => c.id === 'mcp/mylocal');
    expect(local?.category).toBe('Local');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd sidecar && pnpm test -- --reporter=verbose 2>&1 | grep -E "PASS|FAIL"
```

- [ ] **Step 3: Rewrite listConnectors in connectors.ts**

Replace the existing `listConnectors` function:

```typescript
export interface ListConnectorsResult {
  connectors: ConnectorEntry[];
  warning?: string;
}

export async function listConnectors(authStorage: AuthStorage): Promise<ListConnectorsResult> {
  // 1. OAuth providers
  const configured = new Set(authStorage.list());
  const oauthConnectors: ConnectorEntry[] = getOAuthProviders().map((p) => ({
    id: `oauth/${p.id}`,
    name: p.name,
    description: OAUTH_DESCRIPTIONS[p.id] ?? `Connect with ${p.name}`,
    category: 'OAuth',
    type: 'oauth',
    status: configured.has(p.id) ? 'connected' : 'available',
    requiresToken: false,
  }));

  // 2. Read mcp.json (merged via loadMcpConfig)
  let mcpServers: Record<string, unknown> = {};
  let mcpLoadWarning = false;
  try {
    const config = loadMcpConfig();
    mcpServers = config.mcpServers as Record<string, unknown>;
  } catch {
    mcpLoadWarning = true;
    // return empty mcp section; rest unaffected
  }

  // 3. Catalog entries — determine status via mcp.json + keychain
  let keychainFailed = false;
  const remoteMcpConnectors: ConnectorEntry[] = [];

  for (const entry of REMOTE_MCP_CATALOG) {
    const inMcp = entry.slug in mcpServers;
    let status: 'connected' | 'available' = 'available';

    if (!entry.requiresToken) {
      status = inMcp ? 'connected' : 'available';
    } else if (!keychainFailed) {
      try {
        const token = await keychainGet(entry.slug);
        if (inMcp && token) {
          status = 'connected';
        } else if (inMcp && !token) {
          // mcp.json entry but no keychain token → stale mcp entry, self-heal: status available
          status = 'available';
        } else if (!inMcp && token) {
          // keychain entry but no mcp.json → stale keychain entry; silently delete it
          status = 'available';
          keychainDelete(entry.slug).catch(err =>
            console.warn(`[connectors] Failed to delete stale keychain entry remote-mcp/${entry.slug}:`, err)
          );
        } else {
          status = 'available';
        }
      } catch {
        keychainFailed = true;
        status = 'available';
      }
    }

    remoteMcpConnectors.push({
      id: `remote-mcp/${entry.slug}`,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      type: 'remote-mcp',
      status,
      logoSvg: entry.logoSvg,
      url: entry.url,
      docsUrl: entry.docsUrl,
      requiresToken: entry.requiresToken,
    });
  }

  // 4. Local mcp entries — keys NOT matching any catalog slug
  const localMcpConnectors: ConnectorEntry[] = [];
  if (!mcpLoadWarning) {
    for (const [name, serverEntry] of Object.entries(mcpServers)) {
      if (CATALOG_SLUGS.has(name)) continue; // handled above as catalog
      const entry = serverEntry as Record<string, unknown>;
      const description = typeof entry?.command === 'string'
        ? `${entry.command} server`
        : typeof entry?.url === 'string'
          ? entry.url as string
          : 'MCP server';
      localMcpConnectors.push({
        id: `mcp/${name}`,
        name,
        description,
        category: 'Local',
        type: 'mcp',
        status: 'connected',
        requiresToken: false,
      });
    }
  }

  const warning = keychainFailed
    ? 'Could not read credentials store. Some connectors may show as available.'
    : undefined;

  return {
    connectors: [...oauthConnectors, ...remoteMcpConnectors, ...localMcpConnectors],
    warning,
  };
}
```

- [ ] **Step 4: Run all tests**

```bash
cd sidecar && pnpm test -- --reporter=verbose
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add sidecar/connectors.ts sidecar/connectors.test.ts
git commit -m "feat: update listConnectors with catalog merge, keychain status, warning field"
```

---

### Task 5: addRemoteMcpConnector and removeRemoteMcpConnector

**Files:**
- Modify: `sidecar/connectors.ts`
- Modify: `sidecar/connectors.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `sidecar/connectors.test.ts`:

```typescript
import { addRemoteMcpConnector, removeRemoteMcpConnector } from './connectors.js';

// Re-use the fs mock from Task 3 tests.
// writeMcpEntry / removeMcpEntry are also mocked since they call fs internally.
vi.mock('./connectors.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./connectors.js')>();
  return {
    ...actual,
    writeMcpEntry: vi.fn(),
    removeMcpEntry: vi.fn(),
    keychainSet: vi.fn(),
    keychainDelete: vi.fn(),
    keychainGet: vi.fn(),
    readRawMcpConfig: vi.fn(() => ({})),
  };
});
// NOTE: Because vitest module mocking is tricky with the same module under test,
// the recommended approach is to test addRemoteMcpConnector / removeRemoteMcpConnector
// by mocking keytar + fs at the top level (as done above in Task 3 tests).
// The tests below rely on those mocks already being set up.

describe('addRemoteMcpConnector', () => {
  beforeEach(() => {
    vi.mocked(keytar.setPassword).mockResolvedValue();
    vi.mocked(keytar.getPassword).mockResolvedValue(null);
    // mock readRawMcpConfig to return empty (no duplicates)
  });

  it('rejects id with invalid chars', async () => {
    const result = await addRemoteMcpConnector({ id: 'UPPER', name: 'Test', url: 'https://example.com', token: 'tok' });
    expect(result.error?.field).toBe('id');
  });

  it('rejects catalog slug as custom connector', async () => {
    const result = await addRemoteMcpConnector({ id: 'stripe', name: 'Stripe', url: 'https://example.com', token: 'tok' });
    expect(result.error?.message).toMatch(/reserved/i);
  });

  it('rejects url not starting with https://', async () => {
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My', url: 'http://example.com', token: 'tok' });
    expect(result.error?.field).toBe('url');
  });

  it('rejects missing token when requiresToken is true (custom)', async () => {
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My', url: 'https://example.com' });
    expect(result.error?.field).toBe('token');
  });

  it('returns connected entry on success', async () => {
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My Server', url: 'https://example.com', token: 'tok' });
    expect(result.entry?.status).toBe('connected');
    expect(result.entry?.id).toBe('remote-mcp/my-server');
  });

  it('409 on duplicate id already in mcp.json', async () => {
    // Seed real mcp.json, then confirm duplicate id is rejected
    writeMcpEntry('my-server', 'https://existing.example.com');
    const result = await addRemoteMcpConnector({ id: 'my-server', name: 'My', url: 'https://new.example.com', token: 'tok' });
    expect(result.error?.status).toBe(409);
    expect(result.error?.message).toMatch(/already exists/i);
    removeMcpEntry('my-server');
  });

  it('409 on duplicate URL already in mcp.json', async () => {
    writeMcpEntry('other-server', 'https://duplicate.example.com');
    const result = await addRemoteMcpConnector({ id: 'new-server', name: 'New', url: 'https://duplicate.example.com', token: 'tok' });
    expect(result.error?.status).toBe(409);
    expect(result.error?.message).toMatch(/url already exists/i);
    removeMcpEntry('other-server');
  });

  it('id duplicate check runs before url duplicate check (both dup: id error returned)', async () => {
    writeMcpEntry('same-id', 'https://same-url.example.com');
    const result = await addRemoteMcpConnector({ id: 'same-id', name: 'X', url: 'https://same-url.example.com', token: 'tok' });
    expect(result.error?.message).toMatch(/name already exists/i);
    removeMcpEntry('same-id');
  });
});

describe('removeRemoteMcpConnector', () => {
  it('returns 404 if not in mcp.json and not in keychain', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValue(false);
    const result = await removeRemoteMcpConnector('nonexistent');
    expect(result.notFound).toBe(true);
  });

  it('returns success when removed from both', async () => {
    vi.mocked(keytar.deletePassword).mockResolvedValue(true);
    const result = await removeRemoteMcpConnector('my-server');
    expect(result.success).toBe(true);
  });

  it('rejects invalid slug', async () => {
    const result = await removeRemoteMcpConnector('INVALID!');
    expect(result.error).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd sidecar && pnpm test -- --reporter=verbose 2>&1 | grep -E "addRemoteMcp|removeRemoteMcp"
```

- [ ] **Step 3: Implement addRemoteMcpConnector and removeRemoteMcpConnector in connectors.ts**

Add after the helpers:

```typescript
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MAX_CUSTOM_CONNECTORS = 200;

export interface ConnectorError {
  field?: string;
  message: string;
  status: 400 | 409 | 500;
}

export interface AddConnectorResult {
  entry?: ConnectorEntry;
  error?: ConnectorError;
}

export interface RemoveConnectorResult {
  success?: boolean;
  notFound?: boolean;
  error?: ConnectorError;
}

export interface AddConnectorInput {
  id: string;
  name: string;
  url: string;
  token?: string;
}

export async function addRemoteMcpConnector(input: AddConnectorInput): Promise<AddConnectorResult> {
  const { id, name, url, token } = input;

  // Validation — all checks before any writes
  if (!SLUG_REGEX.test(id)) {
    return { error: { field: 'id', message: 'Invalid server name', status: 400 } };
  }
  if (CATALOG_SLUGS.has(id)) {
    return { error: { field: 'id', message: 'This name is reserved for a catalog connector.', status: 400 } };
  }
  if (!name || !name.trim()) {
    return { error: { field: 'name', message: 'Name is required', status: 400 } };
  }
  if (name.trim().length > 64) {
    return { error: { field: 'name', message: 'Name must be 64 characters or fewer', status: 400 } };
  }
  if (!url || !url.trim()) {
    return { error: { field: 'url', message: 'Server URL is required', status: 400 } };
  }
  const trimmedUrl = url.trim();
  if (!trimmedUrl.toLowerCase().startsWith('https://')) {
    return { error: { field: 'url', message: 'Must be a valid https:// URL', status: 400 } };
  }
  if (trimmedUrl.length > 2048) {
    return { error: { field: 'url', message: 'URL is too long', status: 400 } };
  }

  // Resolve requiresToken from catalog (catalog entries may have requiresToken:false)
  // Custom connectors (not in catalog) always requiresToken = true
  const catalogEntry = REMOTE_MCP_CATALOG.find(e => e.slug === id);
  const requiresToken = catalogEntry ? catalogEntry.requiresToken : true;
  if (requiresToken && !token) {
    return { error: { field: 'token', message: 'Auth token is required', status: 400 } };
  }

  // Duplicate checks (both before any writes; id check first)
  const existing = readRawMcpConfig();
  const customCount = Object.keys(existing).filter(k => !CATALOG_SLUGS.has(k)).length;
  if (customCount >= MAX_CUSTOM_CONNECTORS) {
    return { error: { message: 'Maximum number of custom connectors reached', status: 400 } };
  }
  if (id in existing) {
    return { error: { field: 'id', message: 'A connector with this name already exists', status: 409 } };
  }
  const existingUrls = Object.values(existing)
    .map(e => {
      const entry = e as Record<string, unknown>;
      return typeof entry.url === 'string' ? entry.url.trim().toLowerCase() : '';
    })
    .filter(Boolean);
  if (existingUrls.includes(trimmedUrl.toLowerCase())) {
    return { error: { field: 'url', message: 'A server with this URL already exists', status: 409 } };
  }

  // Write mcp.json first
  try {
    writeMcpEntry(id, trimmedUrl);
  } catch {
    return { error: { message: 'Failed to save server. Please try again.', status: 500 } };
  }

  // Write keychain
  try {
    await keychainSet(id, token!);
  } catch {
    // Rollback mcp.json
    try { removeMcpEntry(id); } catch { /* log only */ }
    return { error: { message: 'Failed to save credentials. Your connection was not saved.', status: 500 } };
  }

  const entry: ConnectorEntry = {
    id: `remote-mcp/${id}`,
    name: name.trim(),
    description: catalogEntry?.description ?? trimmedUrl,
    category: catalogEntry?.category ?? 'Custom',
    type: 'remote-mcp',
    status: 'connected',
    url: trimmedUrl,
    docsUrl: catalogEntry?.docsUrl,
    logoSvg: catalogEntry?.logoSvg,
    requiresToken,
  };

  return { entry };
}

export async function removeRemoteMcpConnector(slug: string): Promise<RemoveConnectorResult> {
  if (!SLUG_REGEX.test(slug)) {
    return { error: { message: 'Invalid connector id', status: 400 } };
  }

  let removedFromMcp = false;
  let removedFromKeychain = false;

  try {
    removedFromMcp = removeMcpEntry(slug);
  } catch {
    return { error: { message: 'Failed to remove server', status: 500 } };
  }

  try {
    removedFromKeychain = await keychainDelete(slug);
  } catch {
    // Log warning; stale entry cleaned up on next GET
    console.warn(`[connectors] Failed to delete keychain entry for remote-mcp/${slug}`);
  }

  if (!removedFromMcp && !removedFromKeychain) {
    return { notFound: true };
  }

  return { success: true };
}
```

- [ ] **Step 4: Run all tests**

```bash
cd sidecar && pnpm test -- --reporter=verbose
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add sidecar/connectors.ts sidecar/connectors.test.ts
git commit -m "feat: add addRemoteMcpConnector and removeRemoteMcpConnector with full validation"
```

---

## Chunk 2: Sidecar API routes

### Task 6: Update server.ts routes

**Files:**
- Modify: `sidecar/server.ts`

- [ ] **Step 1: Update GET /api/connectors to pass through new response shape**

In `sidecar/server.ts`, replace the connectors GET route:

```typescript
// REST Endpoint to list all connectors (OAuth providers + remote-MCP catalog + local MCP)
app.get('/api/connectors', async (_req: Request, res: Response) => {
  try {
    const result = await listConnectors(globalAuthStorage);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
```

- [ ] **Step 2: Add imports and POST/DELETE routes**

Update the import at top of `server.ts`:

```typescript
import { listConnectors, addRemoteMcpConnector, removeRemoteMcpConnector } from './connectors.js';
```

Add the two new routes after the GET connectors route:

```typescript
// POST /api/connectors/remote-mcp — connect a catalog or custom remote MCP server
app.post('/api/connectors/remote-mcp', async (req: Request, res: Response) => {
  const { id, name, url, token } = req.body as {
    id?: string;
    name?: string;
    url?: string;
    token?: string;
  };

  if (!id || !name || !url) {
    res.status(400).json({ error: 'Missing required fields: id, name, url' });
    return;
  }

  const result = await addRemoteMcpConnector({ id, name, url, token });

  if (result.error) {
    res.status(result.error.status).json({ error: result.error.message, field: result.error.field });
    return;
  }

  res.json(result.entry);
});

// DELETE /api/connectors/remote-mcp/:id — disconnect a remote MCP server
app.delete('/api/connectors/remote-mcp/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const result = await removeRemoteMcpConnector(id);

  if (result.error) {
    res.status(result.error.status).json({ error: result.error.message });
    return;
  }
  if (result.notFound) {
    // Treat 404 as success (already disconnected)
    res.status(204).send();
    return;
  }

  res.status(204).send();
});
```

- [ ] **Step 3: Run existing tests to make sure nothing broke**

```bash
cd sidecar && pnpm test -- --reporter=verbose
```

Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add sidecar/server.ts
git commit -m "feat: update GET /api/connectors response shape, add POST and DELETE /api/connectors/remote-mcp routes"
```

---

## Chunk 3: Frontend

### Task 7: ConnectorsPage — data layer, ConnectorLogo, 3-column grid, category filter

**Files:**
- Modify: `src/ConnectorsPage.tsx`

This task rewrites the entire file. Read the current file before editing, then replace it.

- [ ] **Step 1: Replace ConnectorsPage.tsx**

```typescript
import { useState, useEffect, useCallback, useRef } from "react";
import { Network, Search, Plus, X } from "lucide-react";
import { API_BASE } from "./config";
import { openUrl } from "@tauri-apps/plugin-opener";

// ── Types ────────────────────────────────────────────────────────────────────

interface ConnectorEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  type: "oauth" | "mcp" | "remote-mcp";
  status: "connected" | "available";
  logoSvg?: string;
  url?: string;
  docsUrl?: string;
  requiresToken: boolean;
}

interface GetConnectorsResponse {
  connectors: ConnectorEntry[];
  warning?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORIES = [
  "Productivity",
  "Google",
  "Microsoft",
  "Communication",
  "CRM & Sales",
  "Finance",
  "Developer Tools",
  "Database",
  "E-commerce & Content",
  "AI/ML",
] as const;

const ICON_COLORS: Record<string, string> = {
  anthropic: "bg-[#cc5500]",
  google: "bg-[#4285f4]",
  github: "bg-[#24292e]",
  openai: "bg-[#10a37f]",
};

const FETCH_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 30_000;

// ── ConnectorLogo ────────────────────────────────────────────────────────────

function ConnectorLogo({ entry }: { entry: ConnectorEntry }) {
  if (entry.logoSvg) {
    return (
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/5 p-1.5"
        dangerouslySetInnerHTML={{ __html: entry.logoSvg }}
      />
    );
  }
  const bg = ICON_COLORS[entry.name.toLowerCase()] ?? "bg-[#374151]";
  return (
    <div className={`w-9 h-9 ${bg} rounded-lg flex items-center justify-center text-white font-bold text-[14px] flex-shrink-0`}>
      {entry.name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── StatusDot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: "connected" | "available" }) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${status === "connected" ? "bg-green-500" : "bg-gray-600"}`} />
      <span className={`text-[10px] font-medium ${status === "connected" ? "text-green-400" : "text-gray-500"}`}>
        {status === "connected" ? "Connected" : "Available"}
      </span>
    </div>
  );
}

// ── Main ConnectorsPage ──────────────────────────────────────────────────────

type FilterTab = "all" | "connected" | "available";

interface ConnectorsPageProps {
  onOpenSettings: () => void;
  refreshKey?: number;
}

// Slug generation for custom connectors
function generateSlug(name: string, existingIds: Set<string>): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "custom";

  if (!existingIds.has(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const candidate = `${base}-${i}`.slice(0, 63);
    if (!existingIds.has(candidate)) return candidate;
  }
  return ""; // signals too-many-duplicates
}

export function ConnectorsPage({ onOpenSettings, refreshKey = 0 }: ConnectorsPageProps) {
  const [connectors, setConnectors] = useState<ConnectorEntry[]>([]);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [category, setCategory] = useState<string>("All");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showCustomPanel, setShowCustomPanel] = useState(false);
  const [dismissedWarning, setDismissedWarning] = useState(false);

  const fetchConnectors = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDismissedWarning(false);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/api/connectors`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GetConnectorsResponse = await res.json();
      setConnectors(data.connectors);
      setWarning(data.warning ?? null);
    } catch (err) {
      setError("Could not load connectors.");
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConnectors(); }, [fetchConnectors, refreshKey]);

  // Filter
  const filtered = connectors.filter((c) => {
    if (tab === "connected" && c.status !== "connected") return false;
    if (tab === "available" && c.status !== "available") return false;
    if (category !== "All" && c.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q);
    }
    return true;
  });

  const customCount = connectors.filter(c => c.type === "remote-mcp" && c.category === "Custom").length;
  const atCustomLimit = customCount >= 200;

  function handleCardClick(connector: ConnectorEntry) {
    if (connector.type === "oauth") { onOpenSettings(); return; }
    if (connector.type === "mcp") return; // local: no action
    if (connector.type === "remote-mcp" && connector.status === "available") {
      // collapse custom panel if open
      if (showCustomPanel) setShowCustomPanel(false);
      setExpandedId(prev => prev === connector.id ? null : connector.id);
    }
  }

  function handleOpenCustomPanel() {
    setExpandedId(null); // collapse any expanded catalog card
    setShowCustomPanel(true);
  }

  return (
    <div className="flex-1 flex flex-col bg-[#111827] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#1f2937]">
        <h1 className="text-[18px] font-semibold text-gray-100 flex items-center gap-2">
          <Network className="w-5 h-5 text-[#c5f016]" />
          Connectors
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="bg-[#1f2937] border border-[#374151] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#c5f016]/50 w-52"
              placeholder="Search connectors"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={handleOpenCustomPanel}
            disabled={atCustomLimit}
            title={atCustomLimit ? "Maximum number of custom connectors reached" : undefined}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold hover:bg-[#d4f518] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="w-3.5 h-3.5" />
            Custom connector
          </button>
        </div>
      </div>

      {/* Tagline */}
      <div className="px-6 py-3 text-[13px] text-gray-400">
        Connect your apps and services so the agent can access and act on your data.
      </div>

      {/* Filter row */}
      <div className="px-6 pb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {(["all", "connected", "available"] as FilterTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors border ${
                tab === t
                  ? "bg-[#374151] text-gray-100 border-[#4b5563]"
                  : "border-[#374151] text-gray-500 hover:text-gray-300"
              }`}
            >
              {t === "all" ? "All" : t === "connected" ? "Connected" : "Available"}
            </button>
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="bg-[#1f2937] border border-[#374151] rounded-lg px-2.5 py-1 text-[12px] text-gray-300 focus:outline-none focus:border-[#c5f016]/50"
        >
          <option value="All">All categories</option>
          {CATEGORIES.map(cat => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
      </div>

      {/* Warning banner */}
      {warning && !dismissedWarning && (
        <div className="mx-6 mb-3 flex items-center justify-between gap-2 bg-yellow-900/30 border border-yellow-700/40 rounded-lg px-4 py-2.5 text-[12px] text-yellow-300">
          <span>{warning}</span>
          <button onClick={() => setDismissedWarning(true)} className="ml-2 text-yellow-400 hover:text-yellow-200">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {/* Custom connector panel */}
        {showCustomPanel && (
          <CustomConnectorPanel
            existingIds={new Set(connectors.map(c => {
              const parts = c.id.split('/');
              return parts[parts.length - 1];
            }))}
            onCancel={() => setShowCustomPanel(false)}
            onSuccess={(entry) => {
              setConnectors(prev => [entry, ...prev]);
              setShowCustomPanel(false);
            }}
          />
        )}

        {loading && (
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-[88px] rounded-xl bg-[#1a2640] animate-pulse border border-[#1f2937]" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <p className="text-red-400 text-[13px]">{error}</p>
            <button
              onClick={fetchConnectors}
              className="px-4 py-1.5 rounded-lg bg-[#1f2937] border border-[#374151] text-[12px] text-gray-300 hover:text-gray-100 transition-colors"
            >
              Retry
            </button>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center h-40 text-gray-500 text-[13px]">
            No connectors found.
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map((connector) => (
              <ConnectorCard
                key={connector.id}
                connector={connector}
                expanded={expandedId === connector.id}
                onCardClick={() => handleCardClick(connector)}
                onConnected={(updated) => {
                  setConnectors(prev => prev.map(c => c.id === updated.id ? updated : c));
                  setExpandedId(null);
                }}
                onDisconnected={(id) => {
                  setConnectors(prev => prev.map(c => c.id === id ? { ...c, status: "available" } : c));
                }}
                onDisconnectError={(id) => {
                  setConnectors(prev => prev.map(c => c.id === id ? { ...c, status: "connected" } : c));
                }}
                onOpenSettings={onOpenSettings}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConnectorCard ────────────────────────────────────────────────────────────

interface ConnectorCardProps {
  connector: ConnectorEntry;
  expanded: boolean;
  onCardClick: () => void;
  onConnected: (entry: ConnectorEntry) => void;
  onDisconnected: (id: string) => void;
  onDisconnectError: (id: string) => void;
  onOpenSettings: () => void;
}

function ConnectorCard({ connector, expanded, onCardClick, onConnected, onDisconnected, onDisconnectError, onOpenSettings }: ConnectorCardProps) {
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  async function handleDisconnect(e: React.MouseEvent) {
    e.stopPropagation();
    setDisconnectError(null);
    // Optimistic update
    onDisconnected(connector.id);
    const slug = connector.id.replace('remote-mcp/', '');
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/connectors/remote-mcp/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      // 204 or 404 both treated as success
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
    } catch {
      // Revert optimistic update
      onDisconnectError(connector.id);
      setDisconnectError('Disconnect failed. Please try again.');
    }
  }

  const isOAuth = connector.type === "oauth";
  const isLocal = connector.type === "mcp";
  const isRemote = connector.type === "remote-mcp";
  const isConnected = connector.status === "connected";
  const isAvailable = connector.status === "available";
  const isClickable = isOAuth || (isRemote && isAvailable);

  return (
    <div className="flex flex-col">
      <div
        onClick={isClickable ? onCardClick : undefined}
        className={`bg-[#141d2e] border rounded-xl p-4 flex items-center gap-3 transition-colors relative ${
          expanded ? "border-[#c5f016]/40" : "border-[#1f2937]"
        } ${
          isClickable ? "cursor-pointer hover:border-[#374151]" : "cursor-default"
        }`}
      >
        <ConnectorLogo entry={connector} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-gray-100 truncate">{connector.name}</p>
          <p className="text-[12px] text-gray-500 mt-0.5 truncate">{connector.description}</p>
          <StatusDot status={connector.status} />
        </div>
        {isRemote && isConnected && !isLocal && (
          <button
            onClick={handleDisconnect}
            className="absolute top-3 right-3 text-gray-600 hover:text-gray-300 transition-colors"
            title="Disconnect"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Disconnect error below card */}
      {disconnectError && (
        <p className="text-[11px] text-red-400 mt-1 px-1">{disconnectError}</p>
      )}

      {/* Inline expand form */}
      {expanded && isRemote && isAvailable && (
        <ConnectForm
          connector={connector}
          onCancel={onCardClick}
          onConnected={onConnected}
        />
      )}
    </div>
  );
}

// ── ConnectForm (inline expand on available remote-mcp card) ─────────────────

interface ConnectFormProps {
  connector: ConnectorEntry;
  onCancel: () => void;
  onConnected: (entry: ConnectorEntry) => void;
}

function ConnectForm({ connector, onCancel, onConnected }: ConnectFormProps) {
  const slug = connector.id.replace('remote-mcp/', '');
  const [url, setUrl] = useState(connector.url ?? '');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function clearFieldError(field: string) {
    setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  }

  async function handleConnect() {
    setErrors({});
    const errs: Record<string, string> = {};
    if (!url.trim()) errs.url = 'Server URL is required';
    else if (!url.trim().toLowerCase().startsWith('https://')) errs.url = 'Must be a valid https:// URL';
    else if (url.trim().length > 2048) errs.url = 'URL is too long';
    if (connector.requiresToken && !token) errs.token = 'Auth token is required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    setSubmitting(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/connectors/remote-mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug, name: connector.name, url: url.trim(), token: token || undefined }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) {
        const field = data.field ?? '_form';
        setErrors({ [field]: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      onConnected(data as ConnectorEntry);
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : 'Something went wrong. Please try again.';
      setErrors({ _form: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-[#141d2e] border border-t-0 border-[#c5f016]/40 rounded-b-xl px-4 pb-4 pt-3 flex flex-col gap-3">
      <div className="h-px bg-[#1f2937]" />

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-gray-400">Server URL</label>
        <input
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.url ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          value={url}
          onChange={(e) => { setUrl(e.target.value); clearFieldError('url'); }}
          placeholder="https://mcp.example.com"
        />
        {errors.url && <p className="text-[11px] text-red-400">{errors.url}</p>}
      </div>

      {connector.requiresToken && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label className="text-[11px] text-gray-400">Auth token</label>
            {connector.docsUrl && (
              <button
                onClick={() => openUrl(connector.docsUrl!)}
                className="text-[11px] text-[#c5f016]/80 hover:text-[#c5f016] transition-colors"
              >
                Get token ↗
              </button>
            )}
          </div>
          <input
            type="password"
            className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
              errors.token ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
            }`}
            value={token}
            onChange={(e) => { setToken(e.target.value); clearFieldError('token'); }}
            placeholder="Paste your token here"
          />
          {errors.token && <p className="text-[11px] text-red-400">{errors.token}</p>}
        </div>
      )}

      {errors._form && <p className="text-[11px] text-red-400">{errors._form}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12px] text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleConnect}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {submitting ? (
            <><span className="w-3 h-3 border border-black/40 border-t-black rounded-full animate-spin" /> Connecting…</>
          ) : 'Connect'}
        </button>
      </div>
    </div>
  );
}

// ── CustomConnectorPanel ─────────────────────────────────────────────────────

interface CustomConnectorPanelProps {
  existingIds: Set<string>;
  onCancel: () => void;
  onSuccess: (entry: ConnectorEntry) => void;
}

function CustomConnectorPanel({ existingIds, onCancel, onSuccess }: CustomConnectorPanelProps) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function clearFieldError(field: string) {
    setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  }

  async function handleAdd() {
    setErrors({});
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    else if (name.trim().length > 64) errs.name = 'Name must be 64 characters or fewer';
    if (!url.trim()) errs.url = 'Server URL is required';
    else if (!url.trim().toLowerCase().startsWith('https://')) errs.url = 'Must be a valid https:// URL';
    else if (url.trim().length > 2048) errs.url = 'URL is too long';
    if (!token) errs.token = 'Auth token is required';
    if (Object.keys(errs).length > 0) { setErrors(errs); return; }

    const slug = generateSlug(name.trim(), existingIds);
    if (!slug) { setErrors({ name: 'Too many connectors with similar names' }); return; }

    setSubmitting(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(`${API_BASE}/api/connectors/remote-mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug, name: name.trim(), url: url.trim(), token }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await res.json();
      if (!res.ok) {
        const field = data.field ?? '_form';
        setErrors({ [field]: data.error ?? 'Something went wrong. Please try again.' });
        return;
      }
      onSuccess(data as ConnectorEntry);
    } catch (err) {
      const msg = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out. Please try again.'
        : 'Something went wrong. Please try again.';
      setErrors({ _form: msg });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-4 bg-[#141d2e] border border-[#c5f016]/30 rounded-xl p-4 flex flex-col gap-3">
      <p className="text-[13px] font-semibold text-gray-100">Add custom connector</p>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-gray-400">Name</label>
        <input
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.name ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          placeholder="My MCP server"
          maxLength={64}
          value={name}
          onChange={(e) => { setName(e.target.value); clearFieldError('name'); }}
        />
        {errors.name && <p className="text-[11px] text-red-400">{errors.name}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-gray-400">Server URL</label>
        <input
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.url ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          placeholder="https://mcp.example.com"
          value={url}
          onChange={(e) => { setUrl(e.target.value); clearFieldError('url'); }}
        />
        {errors.url && <p className="text-[11px] text-red-400">{errors.url}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-[11px] text-gray-400">Auth token</label>
        <input
          type="password"
          className={`w-full bg-[#1f2937] border rounded-lg px-3 py-2 text-[12px] text-gray-100 focus:outline-none ${
            errors.token ? 'border-red-500/60' : 'border-[#374151] focus:border-[#c5f016]/50'
          }`}
          placeholder="Paste your token here"
          value={token}
          onChange={(e) => { setToken(e.target.value); clearFieldError('token'); }}
        />
        {errors.token && <p className="text-[11px] text-red-400">{errors.token}</p>}
      </div>

      {errors._form && <p className="text-[11px] text-red-400">{errors._form}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12px] text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleAdd}
          disabled={submitting}
          className="px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold disabled:opacity-50 transition-colors flex items-center gap-1.5"
        >
          {submitting ? (
            <><span className="w-3 h-3 border border-black/40 border-t-black rounded-full animate-spin" /> Adding…</>
          ) : 'Add connector'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/ravi/Documents/Dev/workwithme && pnpm build 2>&1 | head -30
```

Expected: no TypeScript errors in ConnectorsPage.tsx

- [ ] **Step 3: Commit**

```bash
git add src/ConnectorsPage.tsx
git commit -m "feat: rewrite ConnectorsPage with 3-col grid, inline expand, custom panel, category filter"
```

---

### Task 8: Wire up plugin-opener and verify dev build

**Files:**
- Verify: `src/ConnectorsPage.tsx` uses `@tauri-apps/plugin-opener` correctly

- [ ] **Step 1: Confirm plugin-opener is configured in Tauri**

```bash
grep -r "opener" /Users/ravi/Documents/Dev/workwithme/src-tauri/tauri.conf.json
```

If `opener` is not in `plugins`, add it:

```json
"plugins": {
  "opener": {}
}
```

- [ ] **Step 2: Run dev build to check for runtime errors**

```bash
cd /Users/ravi/Documents/Dev/workwithme && pnpm dev 2>&1 | head -40
```

Expected: sidecar starts on port 4242, Vite builds frontend without errors

- [ ] **Step 3: Commit any tauri.conf.json changes**

```bash
git add src-tauri/tauri.conf.json
git commit -m "chore: ensure opener plugin configured for ConnectorsPage external links"
```

---

### Task 9: Final integration check and tests

- [ ] **Step 1: Run full sidecar test suite**

```bash
cd sidecar && pnpm test -- --reporter=verbose
```

Expected: all tests pass

- [ ] **Step 2: Run TypeScript check on frontend**

```bash
cd /Users/ravi/Documents/Dev/workwithme && pnpm build 2>&1 | tail -10
```

Expected: exit 0, no type errors

- [ ] **Step 3: Final commit**

```bash
git add sidecar/connectors.ts sidecar/connectors.test.ts sidecar/server.ts src/ConnectorsPage.tsx sidecar/package.json sidecar/pnpm-lock.yaml src-tauri/tauri.conf.json
git commit -m "chore: remote MCP connectors implementation complete"
```
