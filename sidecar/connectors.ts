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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.196 15.623H10.38l7.063-7.247H10.38V6.762h6.816L10.38 14.009h6.816v1.614z" fill="#FF4A00"/></svg>',
  },
  {
    slug: 'asana',
    name: 'Asana',
    description: 'Manage tasks and projects in Asana',
    category: 'Productivity',
    url: 'https://mcp.asana.com/v1',
    docsUrl: 'https://developers.asana.com/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="4.5" fill="#F06A6A"/><circle cx="4.5" cy="17" r="4.5" fill="#F06A6A"/><circle cx="19.5" cy="17" r="4.5" fill="#F06A6A"/></svg>',
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Access and modify Airtable bases and records',
    category: 'Productivity',
    url: 'https://mcp.airtable.com/v1',
    docsUrl: 'https://airtable.com/developers/web/api/introduction',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.984.472L.906 4.681a.63.63 0 0 0 0 1.172l11.078 4.209a.63.63 0 0 0 .451 0l11.078-4.21a.63.63 0 0 0 0-1.171L12.435.472a.634.634 0 0 0-.451 0zM1.576 10.4a.63.63 0 0 0-.626.63v8.916a.63.63 0 0 0 .818.602l9.348-3.17a.63.63 0 0 0 .44-.601V7.86a.63.63 0 0 0-.818-.601L1.39 10.43a.63.63 0 0 0-.185.057zm20.847 0a.63.63 0 0 0-.184-.057l-9.348-3.17a.63.63 0 0 0-.818.6v8.917c0 .267.168.504.44.601l9.348 3.17a.63.63 0 0 0 .818-.602v-8.916a.63.63 0 0 0-.256-.543z" fill="#FCB400"/></svg>',
  },
  {
    slug: 'monday',
    name: 'Monday.com',
    description: 'Manage boards and items in Monday.com',
    category: 'Productivity',
    url: 'https://mcp.monday.com/v1',
    docsUrl: 'https://developer.monday.com/apps/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="5" cy="12" r="3.5" fill="#FF3D57"/><circle cx="12" cy="12" r="3.5" fill="#FFCB00"/><circle cx="19" cy="12" r="3.5" fill="#00CA72"/></svg>',
  },
  {
    slug: 'clickup',
    name: 'ClickUp',
    description: 'Manage tasks and docs in ClickUp',
    category: 'Productivity',
    url: 'https://mcp.clickup.com/v1',
    docsUrl: 'https://clickup.com/api/developer-portal/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 15.783l3.38-2.608C8.187 15.51 10.1 16.8 12.012 16.8c1.908 0 3.796-1.265 5.553-3.542L21 15.687C18.71 18.742 15.497 20.8 12.012 20.8c-3.49 0-6.731-2.073-9.012-5.017z" fill="#7B68EE"/><path d="M12.012 3.2L8.025 7.512 3 12.8l3.38 2.608 5.632-5.792 5.56 5.76L21 12.8l-4.988-5.218L12.012 3.2z" fill="#7B68EE"/></svg>',
  },
  {
    slug: 'trello',
    name: 'Trello',
    description: 'Access boards, lists and cards in Trello',
    category: 'Productivity',
    url: 'https://mcp.trello.com/v1',
    docsUrl: 'https://developer.atlassian.com/cloud/trello/rest/api-group-actions/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="3" fill="#0052CC"/><rect x="3" y="3.5" width="7.5" height="13" rx="1.5" fill="#fff"/><rect x="13.5" y="3.5" width="7.5" height="8.5" rx="1.5" fill="#fff"/></svg>',
  },
  {
    slug: 'coda',
    name: 'Coda',
    description: 'Read and write Coda docs and tables',
    category: 'Productivity',
    url: 'https://mcp.coda.io/v1',
    docsUrl: 'https://coda.io/developers/apis/v1',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l7 4.5-7 4.5z" fill="#F46A54"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7.71 3.5L1.15 15l3.43 5.5h15.84L23.85 15 17.29 3.5z" fill="none"/><path d="M8.56 3.5h6.88l6.41 11-3.43 6H5.58l-3.43-6z" fill="#4285F4" opacity=".2"/><path d="M15.44 3.5L21.85 14l-3.43 6H5.58L2.15 14 8.56 3.5h6.88zm0 0L12 3.5 8.56 3.5 2.15 14l1.72 3 6.41-11h6.88l1.71-3z" fill="none"/><polygon points="2.15,14 8.56,3.5 15.44,3.5 21.85,14 18.42,20 5.58,20" fill="none" stroke="none"/><path d="M8.56 3.5L2.15 14l3.43 6h6.42V9.5L8.56 3.5z" fill="#0FA958"/><path d="M15.44 3.5L12 9.5V20h6.42l3.43-6-6.41-10.5z" fill="#FFBA00"/><path d="M2.15 14l3.43 6h12.84l3.43-6H2.15z" fill="#4285F4"/></svg>',
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails via Gmail',
    category: 'Google',
    url: 'https://mcp.googleapis.com/gmail/v1',
    docsUrl: 'https://developers.google.com/gmail/api/guides',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z" fill="#EA4335"/></svg>',
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage events in Google Calendar',
    category: 'Google',
    url: 'https://mcp.googleapis.com/calendar/v1',
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 4h-1V2h-2v2H8V2H6v2H5C3.9 4 3 4.9 3 6v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zm0-13H5V6h14v1z" fill="#4285F4"/><path d="M7 11h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2zM7 15h2v2H7zm4 0h2v2h-2z" fill="#4285F4"/></svg>',
  },
  {
    slug: 'google-docs',
    name: 'Google Docs',
    description: 'Create and edit Google Docs',
    category: 'Google',
    url: 'https://mcp.googleapis.com/docs/v1',
    docsUrl: 'https://developers.google.com/docs/api/how-tos/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" fill="#4285F4"/></svg>',
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read and write Google Sheets spreadsheets',
    category: 'Google',
    url: 'https://mcp.googleapis.com/sheets/v1',
    docsUrl: 'https://developers.google.com/sheets/api/guides/concepts',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13zm-4 8v-2h2v2H9zm0-4v-2h2v2H9zm4 4v-2h2v2h-2zm0-4v-2h2v2h-2z" fill="#34A853"/></svg>',
  },
  {
    slug: 'google-slides',
    name: 'Google Slides',
    description: 'Create and manage Google Slides presentations',
    category: 'Google',
    url: 'https://mcp.googleapis.com/slides/v1',
    docsUrl: 'https://developers.google.com/slides/api/guides/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3l4 5H8l4-5z" fill="#FBBC05"/></svg>',
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    description: 'Access YouTube data and manage content',
    category: 'Google',
    url: 'https://mcp.googleapis.com/youtube/v1',
    docsUrl: 'https://developers.google.com/youtube/v3/getting-started',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M23.495 6.205a3.007 3.007 0 0 0-2.088-2.088c-1.87-.501-9.396-.501-9.396-.501s-7.507-.01-9.396.501A3.007 3.007 0 0 0 .527 6.205a31.247 31.247 0 0 0-.522 5.805 31.247 31.247 0 0 0 .522 5.783 3.007 3.007 0 0 0 2.088 2.088c1.868.502 9.396.502 9.396.502s7.506 0 9.396-.502a3.007 3.007 0 0 0 2.088-2.088 31.247 31.247 0 0 0 .5-5.783 31.247 31.247 0 0 0-.5-5.805zM9.609 15.601V8.408l6.264 3.602z" fill="#FF0000"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20.5 11.5a5 5 0 0 0-4.33-4.96A6.5 6.5 0 0 0 3.5 9.5a4.5 4.5 0 0 0 .5 9H20a4 4 0 0 0 0-8h-.5l.5.5-.5-.5z" fill="#0364B8"/></svg>',
  },
  {
    slug: 'sharepoint',
    name: 'SharePoint',
    description: 'Access SharePoint sites, lists, and documents',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/sharepoint/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/sharepoint/dev/sp-add-ins/get-to-know-the-sharepoint-rest-service',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="9.5" cy="9.5" r="7.5" fill="#036C70"/><circle cx="16" cy="14" r="6" fill="#1A9BA1"/><circle cx="11.5" cy="18.5" r="5.5" fill="#37C6D0"/><path d="M7.5 21h10a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 0-.5-.5h-10a.5.5 0 0 0-.5.5v3a.5.5 0 0 0 .5.5z" fill="#fff"/></svg>',
  },
  {
    slug: 'teams',
    name: 'Microsoft Teams',
    description: 'Send messages and manage channels in Microsoft Teams',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/teams/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/teams-developer-portal',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20 7h-3V5.5a2.5 2.5 0 1 0-5 0V7H9a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h3v2h2v-2h3a3 3 0 0 0 3-3V9a2 2 0 0 0-2-2h-2zm-8 8H9V8h3v7zm7-1a1 1 0 0 1-1 1h-4V8h2v.268A2 2 0 0 0 17 8a2 2 0 0 1 2 2v4z" fill="#5B5EA6"/></svg>',
  },
  {
    slug: 'outlook',
    name: 'Outlook',
    description: 'Manage email and calendar in Microsoft Outlook',
    category: 'Microsoft',
    url: 'https://mcp.microsoft.com/outlook/v1',
    docsUrl: 'https://learn.microsoft.com/en-us/outlook/rest/get-started',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7 4H2v16h5V4zm15 0H9v16h13V4zm-7 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" fill="#0072C6"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.04.036.052a19.9 19.9 0 0 0 5.993 3.03.077.077 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" fill="#5865F2"/></svg>',
  },
  {
    slug: 'zoom',
    name: 'Zoom',
    description: 'Manage Zoom meetings and recordings',
    category: 'Communication',
    url: 'https://mcp.zoom.us/v1',
    docsUrl: 'https://developers.zoom.us/docs/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.5 14.5l-4-2.667V14c0 .827-.673 1.5-1.5 1.5H6c-.827 0-1.5-.673-1.5-1.5v-4C4.5 9.173 5.173 8.5 6 8.5h6c.827 0 1.5.673 1.5 1.5v2.167l4-2.667v5z" fill="#2D8CFF"/></svg>',
  },
  {
    slug: 'twilio',
    name: 'Twilio',
    description: 'Send SMS, calls, and manage Twilio resources',
    category: 'Communication',
    url: 'https://mcp.twilio.com/v1',
    docsUrl: 'https://www.twilio.com/docs/usage/api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zm3.75-11.25a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-4.5-4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm0 4.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z" fill="#F22F46"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M10.038 5.316l.649 1.096C11.511 5.567 12.677 5 14 5a5 5 0 0 1 5 5c0 .344-.035.68-.101 1.004A3.5 3.5 0 0 1 20.5 14.5a3.5 3.5 0 0 1-3.5 3.5H7a4 4 0 0 1-.948-7.893A5.002 5.002 0 0 1 10.038 5.316z" fill="#00A1E0"/></svg>',
  },
  {
    slug: 'hubspot',
    name: 'HubSpot',
    description: 'Manage contacts, deals, and marketing in HubSpot',
    category: 'CRM & Sales',
    url: 'https://mcp.hubspot.com/v1',
    docsUrl: 'https://developers.hubspot.com/docs/api/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17.127 7.677V5.516a1.561 1.561 0 0 0 .9-1.415v-.047a1.56 1.56 0 0 0-1.557-1.557h-.047a1.56 1.56 0 0 0-1.557 1.557v.047a1.561 1.561 0 0 0 .9 1.415v2.161a4.421 4.421 0 0 0-2.106.919L7.927 4.432a1.731 1.731 0 1 0-.769 1.019l6.489 4.08a4.384 4.384 0 0 0-.636 2.264 4.404 4.404 0 0 0 2.616 4.015v2.133a1.56 1.56 0 0 0 .9 2.827h.047a1.56 1.56 0 0 0 .9-2.827v-2.06A4.403 4.403 0 0 0 19 11.795a4.407 4.407 0 0 0-1.873-3.618zm-1.704 6.282a2.285 2.285 0 1 1 0-4.57 2.285 2.285 0 0 1 0 4.57z" fill="#FF7A59"/></svg>',
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    description: 'Manage customer conversations in Intercom',
    category: 'CRM & Sales',
    url: 'https://mcp.intercom.com/v1',
    docsUrl: 'https://developers.intercom.com/intercom-api-reference/reference',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21 0H3C1.344 0 0 1.344 0 3v18c0 1.656 1.344 3 3 3h18c1.656 0 3-1.344 3-3V3c0-1.656-1.344-3-3-3zm-2 14c0 .44-.197.835-.508 1.104A8.96 8.96 0 0 1 12 17a8.96 8.96 0 0 1-6.492-1.896A1.498 1.498 0 0 1 5 14V7.5a1.5 1.5 0 0 1 3 0V13c.952.634 2.394 1 4 1s3.048-.366 4-1V7.5a1.5 1.5 0 0 1 3 0V14z" fill="#1F8ECD"/></svg>',
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Manage support tickets and customers in Zendesk',
    category: 'CRM & Sales',
    url: 'https://mcp.zendesk.com/v1',
    docsUrl: 'https://developer.zendesk.com/api-reference/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.5 10.167C11.5 6.334 8.917 3.25 5.75 3.25S0 6.334 0 10.167h11.5zM11.5 21V10.167L0 21h11.5zM12.5 3.25V14.083L24 3.25H12.5zM12.5 13.833C12.5 17.667 15.083 20.75 18.25 20.75S24 17.667 24 13.833H12.5z" fill="#03363D"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#2CA01C"/><path d="M12 5a7 7 0 0 0-7 7 7 7 0 0 0 7 7 7 7 0 0 0 7-7 7 7 0 0 0-7-7zm0 2a5 5 0 0 1 5 5 5 5 0 0 1-5 5V7zm-1 2v6a5 5 0 0 1-4-4.9A5 5 0 0 1 11 9z" fill="#fff"/></svg>',
  },
  {
    slug: 'xero',
    name: 'Xero',
    description: 'Access accounting and payroll data in Xero',
    category: 'Finance',
    url: 'https://mcp.xero.com/v1',
    docsUrl: 'https://developer.xero.com/documentation/getting-started-guide/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="12" fill="#13B5EA"/><path d="M6.5 8.5l5.5 3.5-5.5 3.5h3l4-2.5v-2L9.5 8.5H6.5zm11 0h-3l-4 2.5v2l4 2.5h3l-5.5-3.5 5.5-3.5z" fill="#fff"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M16.5 15.75c.19-.65.12-1.24-.21-1.68-.3-.4-.77-.63-1.32-.65l-8.42-.11c-.06 0-.11-.03-.14-.08s-.03-.11 0-.16l.17-.48c.19-.65.12-1.24-.21-1.68-.3-.4-.77-.63-1.32-.65L3 10.16c-.06 0-.11-.03-.14-.08s-.03-.11 0-.16l2.52-6.9A.51.51 0 0 1 5.86 2.8h12.28c.19 0 .36.12.44.3l2.52 6.9c.03.09.01.18-.04.25a.27.27 0 0 1-.21.1l-2.05.01c-.55.02-1.02.25-1.32.65-.33.44-.4 1.03-.21 1.68l.17.48c.03.09.01.18-.04.25a.27.27 0 0 1-.21.1l-8.42.11c-.55.02-1.02.25-1.32.65-.33.44-.4 1.03-.21 1.68l.17.48c.03.09.01.18-.04.25a.27.27 0 0 1-.21.1H5.5" fill="none" stroke="#F6821F" stroke-width="1.5"/><path d="M16 15.5c.8 0 1.5.34 2 .88A3 3 0 0 1 21 19.5a3 3 0 0 1-3 3H6a4 4 0 0 1-4-4 4 4 0 0 1 4-4h.17c.17-.29.38-.55.62-.76A3 3 0 0 1 9 13a3 3 0 0 1 2.83 2H16z" fill="#F6821F"/></svg>',
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Access error tracking and performance data in Sentry',
    category: 'Developer Tools',
    url: 'https://mcp.sentry.io/v1',
    docsUrl: 'https://docs.sentry.io/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M14.97 2.25a1.72 1.72 0 0 0-2.97 0l-1.23 2.13a10.6 10.6 0 0 1 5.17 8.62H13.7a8.37 8.37 0 0 0-4.6-7.4l-1.21 2.09a6.14 6.14 0 0 1 3.36 5.31H4.69a.89.89 0 0 0 .86 1H9a10.6 10.6 0 0 1-7.24-3.5l-1.07 1.85A12.35 12.35 0 0 0 9 15h3.93v.85a.89.89 0 0 0 1.78 0V15h2.61A10.6 10.6 0 0 0 12.93 4.38L14.97 2.25z" fill="#362D59"/></svg>',
  },
  {
    slug: 'figma',
    name: 'Figma',
    description: 'Access Figma design files and components',
    category: 'Developer Tools',
    url: 'https://mcp.figma.com/v1',
    docsUrl: 'https://www.figma.com/developers/api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M8 24c2.208 0 4-1.792 4-4v-4H8c-2.208 0-4 1.792-4 4s1.792 4 4 4z" fill="#0ACF83"/><path d="M4 12c0-2.208 1.792-4 4-4h4v8H8c-2.208 0-4-1.792-4-4z" fill="#A259FF"/><path d="M4 4c0-2.208 1.792-4 4-4h4v8H8C5.792 8 4 6.208 4 4z" fill="#F24E1E"/><path d="M12 0h4c2.208 0 4 1.792 4 4s-1.792 4-4 4h-4V0z" fill="#FF7262"/><path d="M20 12c0 2.208-1.792 4-4 4s-4-1.792-4-4 1.792-4 4-4 4 1.792 4 4z" fill="#1ABCFE"/></svg>',
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    description: 'Manage Vercel deployments and projects',
    category: 'Developer Tools',
    url: 'https://mcp.vercel.com/v1',
    docsUrl: 'https://vercel.com/docs/rest-api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2L2 19.5h20L12 2z" fill="#000"/></svg>',
  },
  {
    slug: 'aws',
    name: 'AWS',
    description: 'Access and manage AWS cloud services',
    category: 'Developer Tools',
    url: 'https://mcp.amazonaws.com/v1',
    docsUrl: 'https://docs.aws.amazon.com/general/latest/gr/aws-apis.html',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M7.17 8.4c0 .39.04.7.12.93.09.23.2.48.36.75.06.1.08.2.08.29 0 .13-.08.26-.24.39l-.79.53c-.11.07-.22.11-.32.11-.13 0-.26-.06-.39-.19a4.03 4.03 0 0 1-.46-.6 9.9 9.9 0 0 1-.4-.76c-1 1.18-2.26 1.77-3.78 1.77-1.08 0-1.94-.31-2.57-.93C-.69 10.06-1 9.26-1 8.28c0-1.04.37-1.88 1.11-2.52.74-.63 1.73-.95 2.98-.95.41 0 .84.04 1.29.11.45.07.91.19 1.4.32V4.5c0-.93-.19-1.58-.58-1.95-.39-.38-1.05-.56-2-.56-.43 0-.87.05-1.33.16-.45.11-.9.25-1.32.43-.2.09-.34.14-.43.16-.09.02-.15.03-.2.03-.17 0-.26-.12-.26-.37V1.77c0-.19.02-.33.08-.41.06-.09.17-.17.33-.26.43-.22.95-.4 1.55-.55A7.82 7.82 0 0 1 3.64.3C4.9.3 5.81.6 6.39 1.2c.57.6.86 1.5.86 2.73V8.4zm-5.22 1.93c.39 0 .8-.07 1.23-.22.43-.14.81-.41 1.13-.77.19-.22.33-.47.41-.75.08-.28.13-.62.13-1.02v-.49a10 10 0 0 0-1.12-.2 9.14 9.14 0 0 0-1.14-.07c-.81 0-1.41.16-1.8.49-.39.33-.58.79-.58 1.4 0 .57.14 1 .43 1.29.29.22.7.34 1.31.34zm9.7 1.31c-.21 0-.35-.04-.44-.12-.09-.07-.17-.23-.24-.44L9.3 4.3c-.07-.22-.11-.36-.11-.44 0-.17.08-.27.25-.27h1.02c.22 0 .37.04.45.12.09.07.16.23.22.44l1.7 6.7 1.58-6.7c.06-.22.13-.37.22-.44.09-.07.25-.12.46-.12h.83c.22 0 .37.04.46.12.09.07.17.23.22.44l1.6 6.79 1.75-6.79c.06-.22.14-.37.22-.44.09-.07.24-.12.45-.12h.97c.17 0 .26.09.26.27 0 .05-.01.11-.03.17l-.06.27-2.28 6.78c-.07.22-.14.37-.23.44-.09.07-.24.12-.44.12h-.89c-.22 0-.37-.04-.46-.12-.09-.08-.17-.23-.22-.45L15.4 5.6l-1.57 6.48c-.06.22-.13.37-.22.45-.09.08-.24.12-.46.12h-.89zm12.1.26c-.54 0-1.08-.06-1.6-.19-.52-.13-.93-.27-1.2-.43-.17-.1-.29-.21-.33-.31a.79.79 0 0 1-.07-.31V10.3c0-.25.09-.37.27-.37.07 0 .14.01.21.04.07.02.17.07.28.12.38.17.79.3 1.23.39.44.09.87.14 1.31.14.69 0 1.23-.12 1.6-.37.37-.24.56-.59.56-1.04 0-.31-.1-.56-.29-.77-.2-.21-.57-.4-1.12-.57l-1.61-.5c-.81-.25-1.41-.63-1.79-1.12A2.7 2.7 0 0 1 20 4.56c0-.46.1-.87.29-1.22.2-.35.46-.66.79-.91.33-.26.71-.45 1.15-.58.44-.14.91-.2 1.4-.2.24 0 .49.01.73.05.25.03.47.08.69.13.21.06.41.12.6.19.19.07.33.14.44.21.15.09.25.19.31.29.06.1.09.22.09.38v.58c0 .25-.09.38-.26.38a1.18 1.18 0 0 1-.43-.14 5.17 5.17 0 0 0-2.14-.44c-.63 0-1.13.1-1.47.31-.34.21-.51.53-.51.97 0 .31.11.57.33.78.22.21.62.42 1.2.6l1.57.5c.8.25 1.38.61 1.73 1.07.35.46.52.99.52 1.58 0 .47-.09.9-.27 1.27-.19.37-.45.7-.79.96-.34.27-.74.47-1.21.61-.49.15-1 .22-1.56.22z" fill="#FF9900"/></svg>',
  },
  {
    slug: 'datadog',
    name: 'Datadog',
    description: 'Access monitoring, metrics, and logs in Datadog',
    category: 'Developer Tools',
    url: 'https://mcp.datadoghq.com/v1',
    docsUrl: 'https://docs.datadoghq.com/api/latest/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M21.3 9.77l-1.92-1.33V6.15L17.09 5l-1.75 1.28-1.93-1.33-2.18.74v1.67L9.32 8.7l-.01 2.21 1.62 1.14-.01 3.35-1.6 1.13v2.2l2.2.73 1.74-1.27 1.93 1.32 2.19-.74v-1.67l1.91-1.34V14l1.63-1.15-.01-3.09zM14.4 16.3l-1.54-.25-.96.7-.74-.25V15.2l1.62-1.13.01-3.51-1.62-1.14.01-1.56.73-.24.97.67 1.53-.25.97.67v1.34l-1.91 1.34-.01 3.09 1.91 1.33v1.35l-.97.14z" fill="#632CA6"/></svg>',
  },
  {
    slug: 'pagerduty',
    name: 'PagerDuty',
    description: 'Manage incidents and on-call schedules in PagerDuty',
    category: 'Developer Tools',
    url: 'https://mcp.pagerduty.com/v1',
    docsUrl: 'https://developer.pagerduty.com/api-reference/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M16.46 1.14C15.07.38 13.42.02 10.77.02H3.5v14.49h7.35c2.4 0 4.3-.44 5.72-1.33 1.75-1.1 2.63-2.89 2.63-5.37 0-2.89-.91-4.92-2.74-5.67zm-3.13 8.57c-.66.47-1.65.7-2.96.7H7.44V3.78h2.93c1.29 0 2.26.22 2.93.67.66.44.99 1.17.99 2.19-.01 1.02-.33 1.73-1 2.07zm.22 5.63H3.5V24h3.94v-5.49h5.98c2.09 0 3.72-.39 4.88-1.18 1.16-.79 1.74-1.96 1.74-3.52 0-.31-.03-.61-.08-.88-1.18 1.06-2.86 1.61-4.41 1.41z" fill="#06AC38"/></svg>',
  },
  {
    slug: 'circleci',
    name: 'CircleCI',
    description: 'Manage CI/CD pipelines and jobs in CircleCI',
    category: 'Developer Tools',
    url: 'https://mcp.circleci.com/v1',
    docsUrl: 'https://circleci.com/docs/api/v2/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm0 4.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 15.5a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" fill="#343434"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 3h18v18H3V3zm3 3v12l3-3V9l3 3 3-3v12h3V6H6z" fill="#00E5BF"/></svg>',
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'Access Supabase databases and storage',
    category: 'Database',
    url: 'https://mcp.supabase.com/v1',
    docsUrl: 'https://supabase.com/docs/guides/api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C.111 12.876.706 14.087 1.765 14.087H12.1V22.964c.015.986 1.26 1.41 1.874.637l9.262-11.652c.653-.826.058-2.037-1.001-2.037H11.9V1.036z" fill="#3ECF8E"/></svg>',
  },
  {
    slug: 'planetscale',
    name: 'PlanetScale',
    description: 'Manage PlanetScale MySQL-compatible databases',
    category: 'Database',
    url: 'https://mcp.planetscale.com/v1',
    docsUrl: 'https://planetscale.com/docs/reference/planetscale-api-reference',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="none" stroke="#000" stroke-width="2"/><line x1="12" y1="1" x2="12" y2="23" stroke="#000" stroke-width="2"/><line x1="1" y1="12" x2="23" y2="12" stroke="#000" stroke-width="2"/><path d="M7 3.5C7 3.5 5 8 5 12s2 8.5 2 8.5M17 3.5C17 3.5 19 8 19 12s-2 8.5-2 8.5" fill="none" stroke="#000" stroke-width="1.5"/></svg>',
  },
  {
    slug: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    description: 'Access and manage MongoDB Atlas clusters',
    category: 'Database',
    url: 'https://mcp.mongodb.com/atlas/v1',
    docsUrl: 'https://www.mongodb.com/docs/atlas/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17.193 9.555c-1.264-5.58-4.252-7.243-4.587-7.819-.018-.03-.018-.073 0-.1-.01.025-.01.05 0 .074l-.208.123c-.04.043-.065.09-.073.14C12 2.272 12.026 2.42 12.15 2.9 9.567 5.398 8.14 7.63 8.14 12.127c0 4.82 3.73 8.755 8.24 8.755 4.512 0 8.24-3.935 8.24-8.755 0-4.497-1.428-6.73-4.01-9.227.123-.48.149-.628.023-.8-.008-.05-.033-.097-.073-.14l-.208-.123c.01-.024.01-.05 0-.074.018.027.018.07 0 .1-.335.576-3.323 2.239-4.587 7.819z" fill="#47A248"/></svg>',
  },
  {
    slug: 'firebase',
    name: 'Firebase',
    description: 'Access Firebase Firestore, Auth, and other services',
    category: 'Database',
    url: 'https://mcp.firebase.google.com/v1',
    docsUrl: 'https://firebase.google.com/docs/reference/rest',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3.89 15.673L6.255.461A.542.542 0 0 1 7.27.289L9.813 5.06 3.89 15.673zm16.794 3.308l-2.854-2.855-8.738-16.58a.55.55 0 0 0-1.046.185l-2.44 14.874 9.962 5.97a2.167 2.167 0 0 0 2.174-.032l2.942-1.562zM21.036 18.26l-2.537-11.585a.543.543 0 0 0-.95-.187l-11.394 17.3 9.274-5.338 5.607 4.11z" fill="#FFCA28"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15.337 23.979l4.969-1.076s-2.01-13.57-2.023-13.656a.264.264 0 0 0-.258-.225c-.012 0-1.465-.029-1.465-.029s-.869-.853-1.192-1.173V23.98zM14.38.876a.26.26 0 0 0-.173.053c-.053.04-1.318 1.184-1.318 1.184.016.013 2.47.74 2.47.74s.008-.048.018-.115c.036-.266.109-.769.079-1.075-.047-.447-.432-.77-.81-.787H14.38zM11.47 2.617L9.4 3.28l-.7.214c-.031-.082-.07-.165-.115-.248-.469-.864-1.217-1.323-1.995-1.323-.05 0-.1.003-.149.007C6.38 1.869 5.765 2.26 5.31 2.894c-.33.45-.578 1.014-.754 1.65-.057.202-.105.413-.145.631-.87.268-2.36.727-2.36.727L2 23.979h13.377l-.001-.022V7.82h-.001L11.47 2.617zM9.22 7.58l-1.84.567c-.158-.703-.356-1.19-.585-1.52-.296-.428-.59-.596-.809-.596-.047 0-.089.01-.131.03-.11.052-.235.174-.357.437-.205.437-.334 1.124-.359 1.918L3.42 9.023c.094-2.264.686-3.884 1.663-4.895.663-.688 1.462-1.054 2.317-1.096h.16c.94 0 1.814.5 2.451 1.46.295.442.52.98.693 1.608l-.484.48zM7.12 8.188l-1.426.44c.098-.832.27-1.434.484-1.852.204-.4.44-.574.608-.574.046 0 .09.011.13.031.163.07.367.345.504 1.053l-.3.902zm5.272 7.714c0 1.343-1.088 2.433-2.431 2.433S7.53 17.245 7.53 15.902c0-1.343 1.089-2.432 2.431-2.432 1.343 0 2.431 1.089 2.431 2.432z" fill="#95BF47"/></svg>',
  },
  {
    slug: 'wordpress',
    name: 'WordPress',
    description: 'Manage WordPress posts, pages, and media',
    category: 'E-commerce & Content',
    url: 'https://mcp.wordpress.com/v1',
    docsUrl: 'https://developer.wordpress.com/docs/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2C6.486 2 2 6.486 2 12s4.486 10 10 10 10-4.486 10-10S17.514 2 12 2zm0 1.5c1.808 0 3.484.56 4.863 1.504L5.004 16.863A8.48 8.48 0 0 1 3.5 12c0-4.687 3.813-8.5 8.5-8.5zm0 17c-1.808 0-3.484-.56-4.863-1.504l11.859-11.859A8.48 8.48 0 0 1 20.5 12c0 4.687-3.813 8.5-8.5 8.5z" fill="#21759B"/></svg>',
  },
  {
    slug: 'webflow',
    name: 'Webflow',
    description: 'Manage Webflow sites, collections, and items',
    category: 'E-commerce & Content',
    url: 'https://mcp.webflow.com/v1',
    docsUrl: 'https://developers.webflow.com/reference/rest-introduction',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M17.803 6l-4.598 9.422L11.12 6H7.49L5 18h3.293l1.32-6.636L11.874 18h2.395l3.374-6.757L18.88 18H22L19.51 6h-1.707z" fill="#4353FF"/></svg>',
  },
  {
    slug: 'dropbox',
    name: 'Dropbox',
    description: 'Access and manage files in Dropbox',
    category: 'E-commerce & Content',
    url: 'https://mcp.dropbox.com/v1',
    docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M6 2L0 6l6 4 6-4zm12 0l-6 4 6 4 6-4zM0 14l6 4 6-4-6-4zm18-4l-6 4 6 4 6-4zM6 19.5L12 16l6 3.5L12 23z" fill="#0061FF"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#FFD21E"/><circle cx="8.5" cy="10.5" r="1.5" fill="#333"/><circle cx="15.5" cy="10.5" r="1.5" fill="#333"/><path d="M7.5 15.5c0 0 1 3 4.5 3s4.5-3 4.5-3" fill="none" stroke="#333" stroke-width="1.5" stroke-linecap="round"/><path d="M6.5 7.5C7 6 8.5 5 10 5.5M17.5 7.5C17 6 15.5 5 14 5.5" fill="none" stroke="#333" stroke-width="1.2" stroke-linecap="round"/></svg>',
  },
  {
    slug: 'replicate',
    name: 'Replicate',
    description: 'Run machine learning models on Replicate',
    category: 'AI/ML',
    url: 'https://mcp.replicate.com/v1',
    docsUrl: 'https://replicate.com/docs/reference/http',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 2h12.5L21 7.5V22H3V2zm13 0v6h5M8 10h8M8 14h8M8 18h5" fill="none" stroke="#000" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>',
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
    type: 'oauth' as const,
    status: (configured.has(p.id) ? 'connected' : 'available') as 'connected' | 'available',
    requiresToken: false,
  }));

  // 2. Read mcp.json
  let mcpServers: Record<string, unknown> = {};
  let mcpLoadFailed = false;
  try {
    const config = loadMcpConfig();
    mcpServers = config.mcpServers as Record<string, unknown>;
  } catch {
    mcpLoadFailed = true;
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
        } else if (!inMcp && token) {
          // Stale keychain entry — no mcp.json record; silently delete it
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

  // 4. Local mcp entries — keys not matching any catalog slug
  const localMcpConnectors: ConnectorEntry[] = [];
  if (!mcpLoadFailed) {
    for (const [name, serverEntry] of Object.entries(mcpServers)) {
      if (CATALOG_SLUGS.has(name)) continue;
      const entry = serverEntry as Record<string, unknown>;
      const description = typeof entry?.command === 'string'
        ? `${entry.command} server`
        : typeof entry?.url === 'string'
          ? (entry.url as string)
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

  const catalogEntry = REMOTE_MCP_CATALOG.find(e => e.slug === id);
  const requiresToken = catalogEntry ? catalogEntry.requiresToken : true;
  if (requiresToken && !token) {
    return { error: { field: 'token', message: 'Auth token is required', status: 400 } };
  }

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
      const ent = e as Record<string, unknown>;
      return typeof ent.url === 'string' ? ent.url.trim().toLowerCase() : '';
    })
    .filter(Boolean);
  if (existingUrls.includes(trimmedUrl.toLowerCase())) {
    return { error: { field: 'url', message: 'A server with this URL already exists', status: 409 } };
  }

  try {
    writeMcpEntry(id, trimmedUrl);
  } catch {
    return { error: { message: 'Failed to save server. Please try again.', status: 500 } };
  }

  if (token) {
    try {
      await keychainSet(id, token);
    } catch {
      try { removeMcpEntry(id); } catch { /* ignore rollback failure */ }
      return { error: { message: 'Failed to save credentials. Your connection was not saved.', status: 500 } };
    }
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
    console.warn(`[connectors] Failed to delete keychain entry for remote-mcp/${slug}`);
  }

  if (!removedFromMcp && !removedFromKeychain) {
    return { notFound: true };
  }

  return { success: true };
}
