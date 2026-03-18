import { getOAuthProviders } from '@mariozechner/pi-ai/oauth';
import { loadMcpConfig } from 'pi-mcp-adapter/config';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';
import keytar from 'keytar';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';

export interface ConnectorEntry {
  id: string;
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
  slug: string;
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
    description: 'Connect Jira, Confluence, and other Atlassian tools',
    category: 'Productivity',
    url: 'https://mcp.atlassian.com/v1/mcp',
    docsUrl: 'https://developer.atlassian.com/cloud/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.53 2.23c-.17-.24-.52-.24-.69 0L.16 18.96c-.17.24.01.54.34.54h6.93a.74.74 0 0 0 .63-.35l3.47-5.61 3.47 5.61c.13.21.36.35.63.35h6.93c.33 0 .51-.3.34-.54L12.22 2.23a.38.38 0 0 0-.69 0Z" fill="#0052CC"/></svg>',
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Access and manage your Notion workspace',
    category: 'Productivity',
    url: 'https://mcp.notion.com/v1',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z" fill="#000"/></svg>',
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Manage Linear issues and projects',
    category: 'Productivity',
    url: 'https://mcp.linear.app/sse',
    docsUrl: 'https://linear.app/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2.07 13.5l8.43 8.43A10 10 0 0 1 2.07 13.5zm-.03-2.06a10 10 0 0 0 10.52 10.52L2.04 11.44zM22 12a10 10 0 0 0-9.95-10L22 12zm-10 10a10 10 0 0 0 10-10L12 22zM3.22 9.1l11.68 11.68a10.09 10.09 0 0 0 1.57-.87L4.09 7.53A10.09 10.09 0 0 0 3.22 9.1zm2.56-3.85L20.75 20.22a10 10 0 0 0 1.08-1.32L6.9 4.17A10 10 0 0 0 5.78 5.25zM8.73 3.1l12.17 12.17a10 10 0 0 0 .52-1.64L10.37 2.58A10 10 0 0 0 8.73 3.1z" fill="#5E6AD2"/></svg>',
  },
  {
    slug: 'zapier',
    name: 'Zapier',
    description: 'Automate workflows across thousands of apps',
    category: 'Productivity',
    url: 'https://mcp.zapier.com/v1',
    docsUrl: 'https://zapier.com/developer/documentation/mcp',
    requiresToken: true,
  },
  {
    slug: 'asana',
    name: 'Asana',
    description: 'Manage tasks and projects in Asana',
    category: 'Productivity',
    url: 'https://mcp.asana.com/v1',
    docsUrl: 'https://developers.asana.com/docs/mcp',
    requiresToken: true,
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Access and modify Airtable bases and records',
    category: 'Productivity',
    url: 'https://mcp.airtable.com/v1',
    docsUrl: 'https://airtable.com/developers/web/api/introduction',
    requiresToken: true,
  },
  {
    slug: 'monday',
    name: 'Monday.com',
    description: 'Manage boards and items in Monday.com',
    category: 'Productivity',
    url: 'https://mcp.monday.com/v1',
    docsUrl: 'https://developer.monday.com/apps/docs/mcp',
    requiresToken: true,
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    description: 'Manage tasks and docs in ClickUp',
    category: 'Productivity',
    url: 'https://mcp.clickup.com/v1',
    docsUrl: 'https://clickup.com/api/developer-portal/mcp',
    requiresToken: true,
  },
  {
    slug: 'trello',
    name: 'Trello',
    description: 'Access boards, lists and cards in Trello',
    category: 'Productivity',
    url: 'https://mcp.trello.com/v1',
    docsUrl: 'https://developer.atlassian.com/cloud/trello/rest/api-group-actions/',
    requiresToken: true,
  },
  {
    slug: 'coda',
    name: 'Coda',
    description: 'Read and write Coda docs and tables',
    category: 'Productivity',
    url: 'https://mcp.coda.io/v1',
    docsUrl: 'https://coda.io/developers/apis/v1',
    requiresToken: true,
  },
  // Google
  {
    slug: 'google-drive',
    name: 'Google Drive',
    description: 'Access and manage files in Google Drive',
    category: 'Google',
    url: 'https://mcp.googleapis.com/drive/v1',
    docsUrl: 'https://developers.google.com/drive/api/guides/about-sdk',
    requiresToken: true,
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails via Gmail',
    category: 'Google',
    url: 'https://mcp.googleapis.com/gmail/v1',
    docsUrl: 'https://developers.google.com/gmail/api/guides',
    requiresToken: true,
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage events in Google Calendar',
    category: 'Google',
    url: 'https://mcp.googleapis.com/calendar/v1',
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
    requiresToken: true,
  },
  {
    slug: 'google-docs',
    name: 'Google Docs',
    description: 'Create and edit Google Docs',
    category: 'Google',
    url: 'https://mcp.googleapis.com/docs/v1',
    docsUrl: 'https://developers.google.com/docs/api/how-tos/overview',
    requiresToken: true,
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read and write Google Sheets spreadsheets',
    category: 'Google',
    url: 'https://mcp.googleapis.com/sheets/v1',
    docsUrl: 'https://developers.google.com/sheets/api/guides/concepts',
    requiresToken: true,
  },
  {
    slug: 'google-slides',
    name: 'Google Slides',
    description: 'Create and manage Google Slides presentations',
    category: 'Google',
    url: 'https://mcp.googleapis.com/slides/v1',
    docsUrl: 'https://developers.google.com/slides/api/guides/overview',
    requiresToken: true,
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    description: 'Access YouTube data and manage content',
    category: 'Google',
    url: 'https://mcp.googleapis.com/youtube/v1',
    docsUrl: 'https://developers.google.com/youtube/v3/getting-started',
    requiresToken: true,
  },
  // Microsoft
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Access GitHub repositories, issues, and pull requests',
    category: 'Microsoft',
    url: 'https://api.githubcopilot.com/mcp/v1',
    docsUrl: 'https://docs.github.com/en/rest/overview/about-the-rest-api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" fill="#181717"/></svg>',
  },
  {
    slug: 'onedrive',
    name: 'OneDrive',
    description: 'Access and manage files in Microsoft OneDrive',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/onedrive/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/onedrive/developer/rest-api/',
    requiresToken: true,
  },
  {
    slug: 'sharepoint',
    name: 'SharePoint',
    description: 'Access SharePoint sites, lists, and documents',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/sharepoint/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/get-to-know-the-sharepoint-rest-service',
    requiresToken: true,
  },
  {
    slug: 'teams',
    name: 'Microsoft Teams',
    description: 'Send messages and manage channels in Microsoft Teams',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/teams/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/teams-developer-portal',
    requiresToken: true,
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    description: 'Manage email and calendar in Microsoft Outlook',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/outlook/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/outlook/rest/get-started',
    requiresToken: true,
  },
  // Communication
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Send messages and access channels in Slack',
    category: 'Communication',
    url: 'https://mcp.slack.com/v1',
    docsUrl: 'https://api.slack.com/docs',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" fill="#4A154B"/></svg>',
  },
  {
    slug: 'discord',
    name: 'Discord',
    description: 'Send messages and manage Discord servers',
    category: 'Communication',
    url: 'https://mcp.discord.com/v1',
    docsUrl: 'https://discord.com/developers/docs/intro',
    requiresToken: true,
  },
  {
    slug: 'zoom',
    name: 'Zoom',
    description: 'Manage Zoom meetings and recordings',
    category: 'Communication',
    url: 'https://mcp.zoom.us/v1',
    docsUrl: 'https://developers.zoom.us/docs/api/',
    requiresToken: true,
  },
  {
    slug: 'twilio',
    name: 'Twilio',
    description: 'Send SMS, calls, and manage Twilio resources',
    category: 'Communication',
    url: 'https://mcp.twilio.com/v1',
    docsUrl: 'https://www.twilio.com/docs/usage/api',
    requiresToken: true,
  },
  // CRM & Sales
  {
    slug: 'salesforce',
    name: 'Salesforce',
    description: 'Access and manage Salesforce CRM data',
    category: 'CRM & Sales',
    url: 'https://mcp.salesforce.com/v1',
    docsUrl: 'https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/',
    requiresToken: true,
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'Manage contacts, deals, and marketing in HubSpot',
    category: 'CRM & Sales',
    url: 'https://mcp.hubspot.com/v1',
    docsUrl: 'https://developers.hubspot.com/docs/api/overview',
    requiresToken: true,
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    description: 'Manage customer conversations in Intercom',
    category: 'CRM & Sales',
    url: 'https://mcp.intercom.com/v1',
    docsUrl: 'https://developers.intercom.com/intercom-api-reference/reference',
    requiresToken: true,
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Manage support tickets and customers in Zendesk',
    category: 'CRM & Sales',
    url: 'https://mcp.zendesk.com/v1',
    docsUrl: 'https://developer.zendesk.com/api-reference/',
    requiresToken: true,
  },
  // Finance
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Manage payments, customers, and subscriptions in Stripe',
    category: 'Finance',
    url: 'https://mcp.stripe.com',
    docsUrl: 'https://stripe.com/docs/api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" fill="#6772E5"/></svg>',
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    description: 'Manage accounting and finances in QuickBooks',
    category: 'Finance',
    url: 'https://mcp.intuit.com/quickbooks/v1',
    docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
    requiresToken: true,
  },
  {
    slug: 'xero',
    name: 'Xero',
    description: 'Access accounting and payroll data in Xero',
    category: 'Finance',
    url: 'https://mcp.xero.com/v1',
    docsUrl: 'https://developer.xero.com/documentation/getting-started-guide/',
    requiresToken: true,
  },
  // Developer Tools
  {
    slug: 'cloudflare',
    name: 'Cloudflare',
    description: 'Manage Cloudflare zones, DNS, and Workers',
    category: 'Developer Tools',
    url: 'https://mcp.cloudflare.com/v1',
    docsUrl: 'https://developers.cloudflare.com/api/',
    requiresToken: true,
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Access error tracking and performance data in Sentry',
    category: 'Developer Tools',
    url: 'https://mcp.sentry.io/v1',
    docsUrl: 'https://docs.sentry.io/api/',
    requiresToken: true,
  },
  {
    slug: 'figma',
    name: 'Figma',
    description: 'Access Figma design files and components',
    category: 'Developer Tools',
    url: 'https://mcp.figma.com/v1',
    docsUrl: 'https://www.figma.com/developers/api',
    requiresToken: true,
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    description: 'Manage Vercel deployments and projects',
    category: 'Developer Tools',
    url: 'https://mcp.vercel.com/v1',
    docsUrl: 'https://vercel.com/docs/rest-api',
    requiresToken: true,
  },
  {
    slug: 'aws',
    name: 'AWS',
    description: 'Access and manage AWS cloud services',
    category: 'Developer Tools',
    url: 'https://mcp.amazonaws.com/v1',
    docsUrl: 'https://docs.aws.amazon.com/general/latest/gr/aws-apis.html',
    requiresToken: true,
  },
  {
    slug: 'datadog',
    name: 'Datadog',
    description: 'Access monitoring, metrics, and logs in Datadog',
    category: 'Developer Tools',
    url: 'https://mcp.datadoghq.com/v1',
    docsUrl: 'https://docs.datadoghq.com/api/latest/',
    requiresToken: true,
  },
  {
    slug: 'pagerduty',
    name: 'PagerDuty',
    description: 'Manage incidents and on-call schedules in PagerDuty',
    category: 'Developer Tools',
    url: 'https://mcp.pagerduty.com/v1',
    docsUrl: 'https://developer.pagerduty.com/api-reference/',
    requiresToken: true,
  },
  {
    slug: 'circleci',
    name: 'CircleCI',
    description: 'Manage CI/CD pipelines and jobs in CircleCI',
    category: 'Developer Tools',
    url: 'https://mcp.circleci.com/v1',
    docsUrl: 'https://circleci.com/docs/api/v2/',
    requiresToken: true,
  },
  // Database
  {
    slug: 'neon',
    name: 'Neon',
    description: 'Manage Neon serverless Postgres databases',
    category: 'Database',
    url: 'https://mcp.neon.tech/v1',
    docsUrl: 'https://neon.tech/docs/reference/api-reference',
    requiresToken: true,
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'Access Supabase databases and storage',
    category: 'Database',
    url: 'https://mcp.supabase.com/v1',
    docsUrl: 'https://supabase.com/docs/guides/api',
    requiresToken: true,
  },
  {
    slug: 'planetscale',
    name: 'PlanetScale',
    description: 'Manage PlanetScale MySQL-compatible databases',
    category: 'Database',
    url: 'https://mcp.planetscale.com/v1',
    docsUrl: 'https://planetscale.com/docs/reference/planetscale-api-reference',
    requiresToken: true,
  },
  {
    slug: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    description: 'Access and manage MongoDB Atlas clusters',
    category: 'Database',
    url: 'https://mcp.mongodb.com/atlas/v1',
    docsUrl: 'https://www.mongodb.com/docs/atlas/api/',
    requiresToken: true,
  },
  {
    slug: 'firebase',
    name: 'Firebase',
    description: 'Access Firebase Firestore, Auth, and other services',
    category: 'Database',
    url: 'https://mcp.firebase.google.com/v1',
    docsUrl: 'https://firebase.google.com/docs/reference/rest',
    requiresToken: true,
  },
  // E-commerce & Content
  {
    slug: 'shopify',
    name: 'Shopify',
    description: 'Manage Shopify stores, products, and orders',
    category: 'E-commerce & Content',
    url: 'https://mcp.shopify.com/v1',
    docsUrl: 'https://shopify.dev/docs/api',
    requiresToken: true,
  },
  {
    slug: 'wordpress',
    name: 'WordPress',
    description: 'Manage WordPress posts, pages, and media',
    category: 'E-commerce & Content',
    url: 'https://mcp.wordpress.com/v1',
    docsUrl: 'https://developer.wordpress.com/docs/api/',
    requiresToken: true,
  },
  {
    slug: 'webflow',
    name: 'Webflow',
    description: 'Manage Webflow sites, collections, and items',
    category: 'E-commerce & Content',
    url: 'https://mcp.webflow.com/v1',
    docsUrl: 'https://developers.webflow.com/reference/rest-introduction',
    requiresToken: true,
  },
  {
    slug: 'dropbox',
    name: 'Dropbox',
    description: 'Access and manage files in Dropbox',
    category: 'E-commerce & Content',
    url: 'https://mcp.dropbox.com/v1',
    docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation',
    requiresToken: true,
  },
  // AI/ML
  {
    slug: 'hugging-face',
    name: 'Hugging Face',
    description: 'Access Hugging Face models, datasets, and spaces',
    category: 'AI/ML',
    url: 'https://mcp.huggingface.co/v1',
    docsUrl: 'https://huggingface.co/docs/hub/api',
    requiresToken: true,
  },
  {
    slug: 'replicate',
    name: 'Replicate',
    description: 'Run machine learning models on Replicate',
    category: 'AI/ML',
    url: 'https://mcp.replicate.com/v1',
    docsUrl: 'https://replicate.com/docs/reference/http',
    requiresToken: true,
  },
];

export const CATALOG_SLUGS: Set<string> = new Set(REMOTE_MCP_CATALOG.map(e => e.slug));

const KEYCHAIN_SERVICE = 'workwithme';
// Same path as pi-mcp-adapter's DEFAULT_CONFIG_PATH (~/.pi/agent/mcp.json).
// pi-mcp-adapter does not export this constant so we duplicate it here.
const MCP_CONFIG_PATH = join(homedir(), '.pi', 'agent', 'mcp.json');

export async function keychainGet(slug: string): Promise<string | null> {
  return keytar.getPassword(KEYCHAIN_SERVICE, `remote-mcp/${slug}`);
}

export async function keychainSet(slug: string, token: string): Promise<void> {
  return keytar.setPassword(KEYCHAIN_SERVICE, `remote-mcp/${slug}`, token);
}

export async function keychainDelete(slug: string): Promise<boolean> {
  return keytar.deletePassword(KEYCHAIN_SERVICE, `remote-mcp/${slug}`);
}

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
  } catch {}
  return {};
}

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

const OAUTH_DESCRIPTIONS: Record<string, string> = {
  anthropic: 'Sign in with your Anthropic account',
  google: 'Access Google services',
  github: 'Access your GitHub repositories',
  openai: 'Connect with OpenAI',
};

export function listConnectors(authStorage: AuthStorage): ConnectorEntry[] {
  const configured = new Set(authStorage.list());

  const oauthConnectors: ConnectorEntry[] = getOAuthProviders().map((p) => ({
    id: `oauth/${p.id}`,
    name: p.name,
    description: OAUTH_DESCRIPTIONS[p.id] ?? `Connect with ${p.name}`,
    category: 'OAuth',
    type: 'oauth' as const,
    status: (configured.has(p.id) ? 'connected' : 'available') as 'connected' | 'available',
    requiresToken: false,
  }));

  let mcpConnectors: ConnectorEntry[] = [];
  try {
    const config = loadMcpConfig();
    mcpConnectors = Object.keys(config.mcpServers).map((name) => {
      const entry = config.mcpServers[name] as Record<string, unknown>;
      const description = typeof entry?.command === 'string'
        ? `${entry.command} server`
        : typeof entry?.url === 'string'
          ? entry.url
          : 'MCP server';
      return { id: `mcp/${name}`, name, description, category: 'MCP', type: 'mcp' as const, status: 'connected' as const, requiresToken: false };
    });
  } catch {
    // loadMcpConfig logs warnings internally; return empty list on failure
  }

  return [...oauthConnectors, ...mcpConnectors];
}
