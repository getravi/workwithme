import { getOAuthProviders } from '@mariozechner/pi-ai/oauth';
import { loadMcpConfig } from 'pi-mcp-adapter/config';
import type { AuthStorage } from '@mariozechner/pi-coding-agent';
import { keychainGet, keychainSet, keychainDelete } from './keychain.js';
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0052CC"><path d="M7.12 11.084a.683.683 0 00-1.16.126L.075 22.974a.703.703 0 00.63 1.018h8.19a.678.678 0 00.63-.39c1.767-3.65.696-9.203-2.406-12.52zM11.434.386a15.515 15.515 0 00-.906 15.317l3.95 7.9a.703.703 0 00.628.388h8.19a.703.703 0 00.63-1.017L12.63.38a.664.664 0 00-1.196.006z"/></svg>',
  },
  {
    slug: 'notion',
    name: 'Notion',
    description: 'Access and manage your Notion workspace',
    category: 'Productivity',
    url: 'https://mcp.notion.com/v1',
    docsUrl: 'https://developers.notion.com/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000000"><path d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z"/></svg>',
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Manage Linear issues and projects',
    category: 'Productivity',
    url: 'https://mcp.linear.app/sse',
    docsUrl: 'https://linear.app/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5E6AD2"><path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z"/></svg>',
  },
  {
    slug: 'zapier',
    name: 'Zapier',
    description: 'Automate workflows across thousands of apps',
    category: 'Productivity',
    url: 'https://mcp.zapier.com/v1',
    docsUrl: 'https://zapier.com/developer/documentation/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF4F00"><path d="M4.157 0A4.151 4.151 0 0 0 0 4.161v15.678A4.151 4.151 0 0 0 4.157 24h15.682A4.152 4.152 0 0 0 24 19.839V4.161A4.152 4.152 0 0 0 19.839 0H4.157Zm10.61 8.761h.03a.577.577 0 0 1 .23.038.585.585 0 0 1 .201.124.63.63 0 0 1 .162.431.612.612 0 0 1-.162.435.58.58 0 0 1-.201.128.58.58 0 0 1-.23.042.529.529 0 0 1-.235-.042.585.585 0 0 1-.332-.328.559.559 0 0 1-.038-.235.613.613 0 0 1 .17-.431.59.59 0 0 1 .405-.162Zm2.853 1.572c.03.004.061.004.095.004.325-.011.646.064.937.219.238.144.431.355.552.609.128.279.189.582.185.888v.193a2 2 0 0 1 0 .219h-2.498c.003.227.075.45.204.642a.78.78 0 0 0 .646.265.714.714 0 0 0 .484-.136.642.642 0 0 0 .23-.318l.915.257a1.398 1.398 0 0 1-.28.537c-.14.159-.321.284-.521.355a2.234 2.234 0 0 1-.836.136 1.923 1.923 0 0 1-1.001-.245 1.618 1.618 0 0 1-.665-.703 2.221 2.221 0 0 1-.227-1.036 1.95 1.95 0 0 1 .48-1.398 1.9 1.9 0 0 1 1.3-.488Zm-9.607.023c.162.004.325.026.48.079.207.065.4.174.563.314.26.302.393.692.366 1.088v2.276H8.53l-.109-.711h-.065c-.064.163-.155.31-.272.439a1.122 1.122 0 0 1-.374.264 1.023 1.023 0 0 1-.453.083 1.334 1.334 0 0 1-.866-.264.965.965 0 0 1-.329-.801.993.993 0 0 1 .076-.431 1.02 1.02 0 0 1 .242-.363 1.478 1.478 0 0 1 1.043-.303h.952v-.181a.696.696 0 0 0-.136-.454.553.553 0 0 0-.438-.154.695.695 0 0 0-.378.086.48.48 0 0 0-.193.254l-.99-.144a1.26 1.26 0 0 1 .257-.563c.14-.174.321-.302.533-.378.261-.091.54-.136.82-.129.053-.003.106-.007.163-.007Zm4.384.007c.174 0 .347.038.506.114.182.083.34.211.458.374.257.423.377.911.351 1.406a2.53 2.53 0 0 1-.355 1.448 1.148 1.148 0 0 1-1.009.517c-.204 0-.401-.045-.582-.136a1.052 1.052 0 0 1-.48-.457 1.298 1.298 0 0 1-.114-.234h-.045l.004 1.784h-1.059v-4.713h.904l.117.805h.057c.068-.208.177-.401.328-.56a1.129 1.129 0 0 1 .843-.344h.076v-.004Zm7.559.084h.903l.113.805h.053a1.37 1.37 0 0 1 .235-.484.813.813 0 0 1 .313-.242.82.82 0 0 1 .39-.076h.234v1.051h-.401a.662.662 0 0 0-.313.008.623.623 0 0 0-.272.155.663.663 0 0 0-.174.26.683.683 0 0 0-.027.314v1.875h-1.054v-3.666Zm-17.515.003h3.262v.896L3.73 13.104l.034.113h1.973l.042.9H2.4v-.9l1.931-1.754-.045-.117H2.441v-.896Zm11.815 0h1.055v3.659h-1.055V10.45Zm3.443.684.019.016a.69.69 0 0 0-.351.045.756.756 0 0 0-.287.204c-.11.155-.174.336-.189.522h1.545c-.034-.526-.257-.787-.74-.787h.003Zm-5.718.163c-.026 0-.057 0-.083.004a.78.78 0 0 0-.31.053.746.746 0 0 0-.257.189 1.016 1.016 0 0 0-.204.695v.064c-.015.257.057.507.204.711a.634.634 0 0 0 .253.196.638.638 0 0 0 .314.061.644.644 0 0 0 .578-.265c.14-.223.204-.48.189-.74a1.216 1.216 0 0 0-.181-.711.677.677 0 0 0-.503-.257Zm-4.509 1.266a.464.464 0 0 0-.268.102.373.373 0 0 0-.114.276c0 .053.008.106.027.155a.375.375 0 0 0 .087.132.576.576 0 0 0 .397.11v.004a.863.863 0 0 0 .563-.182.573.573 0 0 0 .211-.457v-.14h-.903Z"/></svg>',
  },
  {
    slug: 'asana',
    name: 'Asana',
    description: 'Manage tasks and projects in Asana',
    category: 'Productivity',
    url: 'https://mcp.asana.com/v1',
    docsUrl: 'https://developers.asana.com/docs/mcp',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#F06A6A"><path d="M18.78 12.653c-2.882 0-5.22 2.336-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.34 5.22-5.22-2.336-5.22-5.22-5.22zm-13.56 0c-2.88 0-5.22 2.337-5.22 5.22s2.338 5.22 5.22 5.22 5.22-2.338 5.22-5.22-2.336-5.22-5.22-5.22zm12-6.525c0 2.883-2.337 5.22-5.22 5.22-2.882 0-5.22-2.337-5.22-5.22 0-2.88 2.338-5.22 5.22-5.22 2.883 0 5.22 2.34 5.22 5.22z"/></svg>',
  },
  {
    slug: 'airtable',
    name: 'Airtable',
    description: 'Access and modify Airtable bases and records',
    category: 'Productivity',
    url: 'https://mcp.airtable.com/v1',
    docsUrl: 'https://airtable.com/developers/web/api/introduction',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#18BFFF"><path d="M11.992 1.966c-.434 0-.87.086-1.28.257L1.779 5.917c-.503.208-.49.908.012 1.116l8.982 3.558a3.266 3.266 0 0 0 2.454 0l8.982-3.558c.503-.196.503-.908.012-1.116l-8.957-3.694a3.255 3.255 0 0 0-1.272-.257zM23.4 8.056a.589.589 0 0 0-.222.045l-10.012 3.877a.612.612 0 0 0-.38.564v8.896a.6.6 0 0 0 .821.552L23.62 18.1a.583.583 0 0 0 .38-.551V8.653a.6.6 0 0 0-.6-.596zM.676 8.095a.644.644 0 0 0-.48.19C.086 8.396 0 8.53 0 8.69v8.355c0 .442.515.737.908.54l6.27-3.006.307-.147 2.969-1.436c.466-.22.43-.908-.061-1.092L.883 8.138a.57.57 0 0 0-.207-.044z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7B68EE"><path d="M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405C19.298 22.065 15.941 24 12.053 24 8.178 24 4.788 22.078 2 18.439zM12.04 6.15l-6.568 5.66-3.036-3.52L12.055 0l9.543 8.296-3.05 3.509z"/></svg>',
  },
  {
    slug: 'trello',
    name: 'Trello',
    description: 'Access boards, lists and cards in Trello',
    category: 'Productivity',
    url: 'https://mcp.trello.com/v1',
    docsUrl: 'https://developer.atlassian.com/cloud/trello/rest/api-group-actions/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0052CC"><path d="M21.147 0H2.853A2.86 2.86 0 000 2.853v18.294A2.86 2.86 0 002.853 24h18.294A2.86 2.86 0 0024 21.147V2.853A2.86 2.86 0 0021.147 0zM10.34 17.287a.953.953 0 01-.953.953h-4a.954.954 0 01-.954-.953V5.38a.953.953 0 01.954-.953h4a.954.954 0 01.953.953zm9.233-5.467a.944.944 0 01-.953.947h-4a.947.947 0 01-.953-.947V5.38a.953.953 0 01.953-.953h4a.954.954 0 01.953.953z"/></svg>',
  },
  {
    slug: 'coda',
    name: 'Coda',
    description: 'Read and write Coda docs and tables',
    category: 'Productivity',
    url: 'https://mcp.coda.io/v1',
    docsUrl: 'https://coda.io/developers/apis/v1',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#F46A54"><path d="M21.194 0H2.806A2.01 2.01 0 0 0 .8 2v20c0 1.1.903 2 2.006 2h18.388a2.01 2.01 0 0 0 2.006-2v-.933c-.033-1.2-.067-3.7-.067-4.834 0-.633-.468-1.166-1.07-1.166-.668 0-1.103.4-1.437.733-1.003.9-2.508 1.067-3.812.833-.601-.133-1.17-.3-1.638-.6-1.438-.833-2.374-2.4-2.374-4.066 0-1.667.936-3.2 2.374-4.067.502-.3 1.07-.467 1.638-.6 1.27-.233 2.809-.067 3.812.833.367.334.802.734 1.437.734.602 0 1.07-.534 1.07-1.167 0-1.1.034-3.633.067-4.833V2c0-1.1-.903-2-2.006-2Z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4285F4"><path d="M12.01 1.485c-2.082 0-3.754.02-3.743.047.01.02 1.708 3.001 3.774 6.62l3.76 6.574h3.76c2.081 0 3.753-.02 3.742-.047-.005-.02-1.708-3.001-3.775-6.62l-3.76-6.574zm-4.76 1.73a789.828 789.861 0 0 0-3.63 6.319L0 15.868l1.89 3.298 1.885 3.297 3.62-6.335 3.618-6.33-1.88-3.287C8.1 4.704 7.255 3.22 7.25 3.214zm2.259 12.653-.203.348c-.114.198-.96 1.672-1.88 3.287a423.93 423.948 0 0 1-1.698 2.97c-.01.026 3.24.042 7.222.042h7.244l1.796-3.157c.992-1.734 1.85-3.23 1.906-3.323l.104-.167h-7.249z"/></svg>',
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read and send emails via Gmail',
    category: 'Google',
    url: 'https://mcp.googleapis.com/gmail/v1',
    docsUrl: 'https://developers.google.com/gmail/api/guides',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#EA4335"><path d="M24 5.457v13.909c0 .904-.732 1.636-1.636 1.636h-3.819V11.73L12 16.64l-6.545-4.91v9.273H1.636A1.636 1.636 0 0 1 0 19.366V5.457c0-2.023 2.309-3.178 3.927-1.964L5.455 4.64 12 9.548l6.545-4.91 1.528-1.145C21.69 2.28 24 3.434 24 5.457z"/></svg>',
  },
  {
    slug: 'google-calendar',
    name: 'Google Calendar',
    description: 'Manage events in Google Calendar',
    category: 'Google',
    url: 'https://mcp.googleapis.com/calendar/v1',
    docsUrl: 'https://developers.google.com/calendar/api/guides/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4285F4"><path d="M18.316 5.684H24v12.632h-5.684V5.684zM5.684 24h12.632v-5.684H5.684V24zM18.316 5.684V0H1.895A1.894 1.894 0 0 0 0 1.895v16.421h5.684V5.684h12.632zm-7.207 6.25v-.065c.272-.144.5-.349.687-.617s.279-.595.279-.982c0-.379-.099-.72-.3-1.025a2.05 2.05 0 0 0-.832-.714 2.703 2.703 0 0 0-1.197-.257c-.6 0-1.094.156-1.481.467-.386.311-.65.671-.793 1.078l1.085.452c.086-.249.224-.461.413-.633.189-.172.445-.257.767-.257.33 0 .602.088.816.264a.86.86 0 0 1 .322.703c0 .33-.12.589-.36.778-.24.19-.535.284-.886.284h-.567v1.085h.633c.407 0 .748.109 1.02.327.272.218.407.499.407.843 0 .336-.129.614-.387.832s-.565.327-.924.327c-.351 0-.651-.103-.897-.311-.248-.208-.422-.502-.521-.881l-1.096.452c.178.616.505 1.082.977 1.401.472.319.984.478 1.538.477a2.84 2.84 0 0 0 1.293-.291c.382-.193.684-.458.902-.794.218-.336.327-.72.327-1.149 0-.429-.115-.797-.344-1.105a2.067 2.067 0 0 0-.881-.689zm2.093-1.931l.602.913L15 10.045v5.744h1.187V8.446h-.827l-2.158 1.557zM22.105 0h-3.289v5.184H24V1.895A1.894 1.894 0 0 0 22.105 0zm-3.289 23.5l4.684-4.684h-4.684V23.5zM0 22.105C0 23.152.848 24 1.895 24h3.289v-5.184H0v3.289z"/></svg>',
  },
  {
    slug: 'google-docs',
    name: 'Google Docs',
    description: 'Create and edit Google Docs',
    category: 'Google',
    url: 'https://mcp.googleapis.com/docs/v1',
    docsUrl: 'https://developers.google.com/docs/api/how-tos/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#4285F4"><path d="M14.727 6.727H14V0H4.91c-.905 0-1.637.732-1.637 1.636v20.728c0 .904.732 1.636 1.636 1.636h14.182c.904 0 1.636-.732 1.636-1.636V6.727h-6zm-.545 10.455H7.09v-1.364h7.09v1.364zm2.727-3.273H7.091v-1.364h9.818v1.364zm0-3.273H7.091V9.273h9.818v1.363zM14.727 6h6l-6-6v6z"/></svg>',
  },
  {
    slug: 'google-sheets',
    name: 'Google Sheets',
    description: 'Read and write Google Sheets spreadsheets',
    category: 'Google',
    url: 'https://mcp.googleapis.com/sheets/v1',
    docsUrl: 'https://developers.google.com/sheets/api/guides/concepts',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#34A853"><path d="M11.318 12.545H7.91v-1.909h3.41v1.91zM14.728 0v6h6l-6-6zm1.363 10.636h-3.41v1.91h3.41v-1.91zm0 3.273h-3.41v1.91h3.41v-1.91zM20.727 6.5v15.864c0 .904-.732 1.636-1.636 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.318v6.5h6.5zm-3.273 2.773H6.545v7.909h10.91v-7.91zm-6.136 4.636H7.91v1.91h3.41v-1.91z"/></svg>',
  },
  {
    slug: 'google-slides',
    name: 'Google Slides',
    description: 'Create and manage Google Slides presentations',
    category: 'Google',
    url: 'https://mcp.googleapis.com/slides/v1',
    docsUrl: 'https://developers.google.com/slides/api/guides/overview',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FBBC04"><path d="M16.09 15.273H7.91v-4.637h8.18v4.637zm1.728-8.523h2.91v15.614c0 .904-.733 1.636-1.637 1.636H4.909a1.636 1.636 0 0 1-1.636-1.636V1.636C3.273.732 4.005 0 4.909 0h9.068v6.75h3.841zm-.363 2.523H6.545v7.363h10.91V9.273zm-2.728-5.979V6h6.001l-6-6v3.294z"/></svg>',
  },
  {
    slug: 'youtube',
    name: 'YouTube',
    description: 'Access YouTube data and manage content',
    category: 'Google',
    url: 'https://mcp.googleapis.com/youtube/v1',
    docsUrl: 'https://developers.google.com/youtube/v3/getting-started',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF0000"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#181717"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#5865F2"><path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>',
  },
  {
    slug: 'zoom',
    name: 'Zoom',
    description: 'Manage Zoom meetings and recordings',
    category: 'Communication',
    url: 'https://mcp.zoom.us/v1',
    docsUrl: 'https://developers.zoom.us/docs/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0B5CFF"><path d="M5.033 14.649H.743a.74.74 0 0 1-.686-.458.74.74 0 0 1 .16-.808L3.19 10.41H1.06A1.06 1.06 0 0 1 0 9.35h3.957c.301 0 .57.18.686.458a.74.74 0 0 1-.161.808L1.51 13.59h2.464c.585 0 1.06.475 1.06 1.06zM24 11.338c0-1.14-.927-2.066-2.066-2.066-.61 0-1.158.265-1.537.686a2.061 2.061 0 0 0-1.536-.686c-1.14 0-2.066.926-2.066 2.066v3.311a1.06 1.06 0 0 0 1.06-1.06v-2.251a1.004 1.004 0 0 1 2.013 0v2.251c0 .586.474 1.06 1.06 1.06v-3.311a1.004 1.004 0 0 1 2.012 0v2.251c0 .586.475 1.06 1.06 1.06zM16.265 12a2.728 2.728 0 1 1-5.457 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0zm-4.82 0a2.728 2.728 0 1 1-5.458 0 2.728 2.728 0 0 1 5.457 0zm-1.06 0a1.669 1.669 0 1 0-3.338 0 1.669 1.669 0 0 0 3.338 0z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FF7A59"><path d="M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z"/></svg>',
  },
  {
    slug: 'intercom',
    name: 'Intercom',
    description: 'Manage customer conversations in Intercom',
    category: 'CRM & Sales',
    url: 'https://mcp.intercom.com/v1',
    docsUrl: 'https://developers.intercom.com/intercom-api-reference/reference',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#6AFDEF"><path d="M21 0H3C1.343 0 0 1.343 0 3v18c0 1.658 1.343 3 3 3h18c1.658 0 3-1.342 3-3V3c0-1.657-1.342-3-3-3zm-5.801 4.399c0-.44.36-.8.802-.8.44 0 .8.36.8.8v10.688c0 .442-.36.801-.8.801-.443 0-.802-.359-.802-.801V4.399zM11.2 3.994c0-.44.357-.799.8-.799s.8.359.8.799v11.602c0 .44-.357.8-.8.8s-.8-.36-.8-.8V3.994zm-4 .405c0-.44.359-.8.799-.8.443 0 .802.36.802.8v10.688c0 .442-.36.801-.802.801-.44 0-.799-.359-.799-.801V4.399zM3.199 6c0-.442.36-.8.802-.8.44 0 .799.358.799.8v7.195c0 .441-.359.8-.799.8-.443 0-.802-.36-.802-.8V6zM20.52 18.202c-.123.105-3.086 2.593-8.52 2.593-5.433 0-8.397-2.486-8.521-2.593-.335-.288-.375-.792-.086-1.128.285-.334.79-.375 1.125-.09.047.041 2.693 2.211 7.481 2.211 4.848 0 7.456-2.186 7.479-2.207.334-.289.839-.25 1.128.086.289.336.25.84-.086 1.128zm.281-5.007c0 .441-.36.8-.801.8-.441 0-.801-.36-.801-.8V6c0-.442.361-.8.801-.8.441 0 .801.357.801.8v7.195z"/></svg>',
  },
  {
    slug: 'zendesk',
    name: 'Zendesk',
    description: 'Manage support tickets and customers in Zendesk',
    category: 'CRM & Sales',
    url: 'https://mcp.zendesk.com/v1',
    docsUrl: 'https://developer.zendesk.com/api-reference/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#03363D"><path d="M12.914 2.904V16.29L24 2.905H12.914zM0 2.906C0 5.966 2.483 8.45 5.543 8.45s5.542-2.484 5.543-5.544H0zm11.086 4.807L0 21.096h11.086V7.713zm7.37 7.84c-3.063 0-5.542 2.48-5.542 5.543H24c0-3.06-2.48-5.543-5.543-5.543z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#635BFF"><path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z"/></svg>',
  },
  {
    slug: 'quickbooks',
    name: 'QuickBooks',
    description: 'Manage accounting and finances in QuickBooks',
    category: 'Finance',
    url: 'https://mcp.intuit.com/quickbooks/v1',
    docsUrl: 'https://developer.intuit.com/app/developer/qbo/docs/get-started',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#236CFF"><path d="M12.32 12.38c0 1.174.974 2.033 2.211 2.033 1.237 0 2.212-.859 2.212-2.033v-2.7h-1.198v2.56c0 .633-.44 1.06-1.017 1.06s-1.017-.424-1.017-1.06V9.68h-1.198l.008 2.699zm7.624-1.619h1.429v3.563h1.198V10.76H24V9.68h-4.056v1.082zM19.17 9.68h-1.198v4.645h1.198V9.679zM7.482 10.761h1.43v3.563h1.197V10.76h1.428V9.68H7.482v1.082zM1.198 9.68H0v4.645h1.198V9.679zm5.653 1.94c0-1.174-.974-2.032-2.212-2.032-1.238 0-2.212.858-2.212 2.032v2.705h1.198v-2.56c0-.633.44-1.06 1.017-1.06s1.018.425 1.018 1.06v2.56h1.197L6.85 11.62h.001z"/></svg>',
  },
  {
    slug: 'xero',
    name: 'Xero',
    description: 'Access accounting and payroll data in Xero',
    category: 'Finance',
    url: 'https://mcp.xero.com/v1',
    docsUrl: 'https://developer.xero.com/documentation/getting-started-guide/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#13B5EA"><path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm6.585 14.655c-1.485 0-2.69-1.206-2.69-2.689 0-1.485 1.207-2.691 2.69-2.691 1.485 0 2.69 1.207 2.69 2.691s-1.207 2.689-2.69 2.689zM7.53 14.644c-.099 0-.192-.041-.267-.116l-2.043-2.04-2.052 2.047c-.069.068-.16.108-.258.108-.202 0-.368-.166-.368-.368 0-.099.04-.191.111-.263l2.04-2.05-2.038-2.047c-.075-.069-.113-.162-.113-.261 0-.203.166-.366.368-.366.098 0 .188.037.258.105l2.055 2.048 2.048-2.045c.069-.071.162-.108.26-.108.211 0 .375.165.375.366 0 .098-.029.188-.104.258l-2.056 2.055 2.055 2.051c.068.069.104.16.104.258 0 .202-.165.368-.365.368h-.01zm8.017-4.591c-.796.101-.882.476-.882 1.404v2.787c0 .202-.165.366-.366.366-.203 0-.367-.165-.368-.366v-4.53c0-.204.16-.366.362-.366.166 0 .316.125.346.289.27-.209.6-.317.93-.317h.105c.195 0 .359.165.359.368 0 .201-.164.352-.375.359 0 0-.09 0-.164.008l.053-.002zm-3.091 2.205H8.625c0 .019.003.037.006.057.02.105.045.211.083.31.194.531.765 1.275 1.829 1.29.33-.003.631-.086.9-.229.21-.12.391-.271.525-.428.045-.058.09-.112.12-.168.18-.229.405-.186.54-.083.164.135.18.391.045.57l-.016.016c-.21.27-.435.495-.689.66-.255.164-.525.284-.811.345-.33.09-.645.104-.975.06-1.095-.135-2.01-.93-2.28-2.01-.06-.21-.09-.42-.09-.645 0-.855.421-1.695 1.125-2.205.885-.615 2.085-.66 3-.075.63.405 1.035 1.021 1.185 1.771.075.419-.21.794-.734.81l.068-.046zm6.129-2.223c-1.064 0-1.931.865-1.931 1.931 0 1.064.866 1.931 1.931 1.931s1.931-.867 1.931-1.931c0-1.065-.866-1.933-1.931-1.933v.002zm0 2.595c-.367 0-.666-.297-.666-.666 0-.367.3-.665.666-.665.367 0 .667.299.667.665 0 .369-.3.667-.667.666zm-8.04-2.603c-.91 0-1.672.623-1.886 1.466v.03h3.776c-.203-.855-.973-1.494-1.891-1.494v-.002z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#F38020"><path d="M16.5088 16.8447c.1475-.5068.0908-.9707-.1553-1.3154-.2246-.3164-.6045-.499-1.0615-.5205l-8.6592-.1123a.1559.1559 0 0 1-.1333-.0713c-.0283-.042-.0351-.0986-.021-.1553.0278-.084.1123-.1484.2036-.1562l8.7359-.1123c1.0351-.0489 2.1601-.8868 2.5537-1.9136l.499-1.3013c.0215-.0561.0293-.1128.0147-.168-.5625-2.5463-2.835-4.4453-5.5499-4.4453-2.5039 0-4.6284 1.6177-5.3876 3.8614-.4927-.3658-1.1187-.5625-1.794-.499-1.2026.119-2.1665 1.083-2.2861 2.2856-.0283.31-.0069.6128.0635.894C1.5683 13.171 0 14.7754 0 16.752c0 .1748.0142.3515.0352.5273.0141.083.0844.1475.1689.1475h15.9814c.0909 0 .1758-.0645.2032-.1553l.12-.4268zm2.7568-5.5634c-.0771 0-.1611 0-.2383.0112-.0566 0-.1054.0415-.127.0976l-.3378 1.1744c-.1475.5068-.0918.9707.1543 1.3164.2256.3164.6055.498 1.0625.5195l1.8437.1133c.0557 0 .1055.0263.1329.0703.0283.043.0351.1074.0214.1562-.0283.084-.1132.1485-.204.1553l-1.921.1123c-1.041.0488-2.1582.8867-2.5527 1.914l-.1406.3585c-.0283.0713.0215.1416.0986.1416h6.5977c.0771 0 .1474-.0489.169-.126.1122-.4082.1757-.837.1757-1.2803 0-2.6025-2.125-4.727-4.7344-4.727"/></svg>',
  },
  {
    slug: 'sentry',
    name: 'Sentry',
    description: 'Access error tracking and performance data in Sentry',
    category: 'Developer Tools',
    url: 'https://mcp.sentry.io/v1',
    docsUrl: 'https://docs.sentry.io/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#362D59"><path d="M13.91 2.505c-.873-1.448-2.972-1.448-3.844 0L6.904 7.92a15.478 15.478 0 0 1 8.53 12.811h-2.221A13.301 13.301 0 0 0 5.784 9.814l-2.926 5.06a7.65 7.65 0 0 1 4.435 5.848H2.194a.365.365 0 0 1-.298-.534l1.413-2.402a5.16 5.16 0 0 0-1.614-.913L.296 19.275a2.182 2.182 0 0 0 .812 2.999 2.24 2.24 0 0 0 1.086.288h6.983a9.322 9.322 0 0 0-3.845-8.318l1.11-1.922a11.47 11.47 0 0 1 4.95 10.24h5.915a17.242 17.242 0 0 0-7.885-15.28l2.244-3.845a.37.37 0 0 1 .504-.13c.255.14 9.75 16.708 9.928 16.9a.365.365 0 0 1-.327.543h-2.287c.029.612.029 1.223 0 1.831h2.297a2.206 2.206 0 0 0 1.922-3.31z"/></svg>',
  },
  {
    slug: 'figma',
    name: 'Figma',
    description: 'Access Figma design files and components',
    category: 'Developer Tools',
    url: 'https://mcp.figma.com/v1',
    docsUrl: 'https://www.figma.com/developers/api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#F24E1E"><path d="M15.852 8.981h-4.588V0h4.588c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.491-4.49 4.491zM12.735 7.51h3.117c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-3.117V7.51zm0 1.471H8.148c-2.476 0-4.49-2.014-4.49-4.49S5.672 0 8.148 0h4.588v8.981zm-4.587-7.51c-1.665 0-3.019 1.355-3.019 3.019s1.354 3.02 3.019 3.02h3.117V1.471H8.148zm4.587 15.019H8.148c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h4.588v8.98zM8.148 8.981c-1.665 0-3.019 1.355-3.019 3.019s1.355 3.019 3.019 3.019h3.117V8.981H8.148zM8.172 24c-2.489 0-4.515-2.014-4.515-4.49s2.014-4.49 4.49-4.49h4.588v4.441c0 2.503-2.047 4.539-4.563 4.539zm-.024-7.51a3.023 3.023 0 0 0-3.019 3.019c0 1.665 1.365 3.019 3.044 3.019 1.705 0 3.093-1.376 3.093-3.068v-2.97H8.148zm7.704 0h-.098c-2.476 0-4.49-2.014-4.49-4.49s2.014-4.49 4.49-4.49h.098c2.476 0 4.49 2.014 4.49 4.49s-2.014 4.49-4.49 4.49zm-.097-7.509c-1.665 0-3.019 1.355-3.019 3.019s1.355 3.019 3.019 3.019h.098c1.665 0 3.019-1.355 3.019-3.019s-1.355-3.019-3.019-3.019h-.098z"/></svg>',
  },
  {
    slug: 'vercel',
    name: 'Vercel',
    description: 'Manage Vercel deployments and projects',
    category: 'Developer Tools',
    url: 'https://mcp.vercel.com/v1',
    docsUrl: 'https://vercel.com/docs/rest-api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000000"><path d="m12 1.608 12 20.784H0Z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#632CA6"><path d="M19.57 17.04l-1.997-1.316-1.665 2.782-1.937-.567-1.706 2.604.087.82 9.274-1.71-.538-5.794zm-8.649-2.498l1.488-.204c.241.108.409.15.697.223.45.117.97.23 1.741-.16.18-.088.553-.43.704-.625l6.096-1.106.622 7.527-10.444 1.882zm11.325-2.712l-.602.115L20.488 0 .789 2.285l2.427 19.693 2.306-.334c-.184-.263-.471-.581-.96-.989-.68-.564-.44-1.522-.039-2.127.53-1.022 3.26-2.322 3.106-3.956-.056-.594-.15-1.368-.702-1.898-.02.22.017.432.017.432s-.227-.289-.34-.683c-.112-.15-.2-.199-.319-.4-.085.233-.073.503-.073.503s-.186-.437-.216-.807c-.11.166-.137.48-.137.48s-.241-.69-.186-1.062c-.11-.323-.436-.965-.343-2.424.6.421 1.924.321 2.44-.439.171-.251.288-.939-.086-2.293-.24-.868-.835-2.16-1.066-2.651l-.028.02c.122.395.374 1.223.47 1.625.293 1.218.372 1.642.234 2.204-.116.488-.397.808-1.107 1.165-.71.358-1.653-.514-1.713-.562-.69-.55-1.224-1.447-1.284-1.883-.062-.477.275-.763.445-1.153-.243.07-.514.192-.514.192s.323-.334.722-.624c.165-.109.262-.178.436-.323a9.762 9.762 0 0 0-.456.003s.42-.227.855-.392c-.318-.014-.623-.003-.623-.003s.937-.419 1.678-.727c.509-.208 1.006-.147 1.286.257.367.53.752.817 1.569.996.501-.223.653-.337 1.284-.509.554-.61.99-.688.99-.688s-.216.198-.274.51c.314-.249.66-.455.66-.455s-.134.164-.259.426l.03.043c.366-.22.797-.394.797-.394s-.123.156-.268.358c.277-.002.838.012 1.056.037 1.285.028 1.552-1.374 2.045-1.55.618-.22.894-.353 1.947.68.903.888 1.609 2.477 1.259 2.833-.294.295-.874-.115-1.516-.916a3.466 3.466 0 0 1-.716-1.562 1.533 1.533 0 0 0-.497-.85s.23.51.23.96c0 .246.03 1.165.424 1.68-.039.076-.057.374-.1.43-.458-.554-1.443-.95-1.604-1.067.544.445 1.793 1.468 2.273 2.449.453.927.186 1.777.416 1.997.065.063.976 1.197 1.15 1.767.306.994.019 2.038-.381 2.685l-1.117.174c-.163-.045-.273-.068-.42-.153.08-.143.241-.5.243-.572l-.063-.111c-.348.492-.93.97-1.414 1.245-.633.359-1.363.304-1.838.156-1.348-.415-2.623-1.327-2.93-1.566 0 0-.01.191.048.234.34.383 1.119 1.077 1.872 1.56l-1.605.177.759 5.908c-.337.048-.39.071-.757.124-.325-1.147-.946-1.895-1.624-2.332-.599-.384-1.424-.47-2.214-.314l-.05.059a2.851 2.851 0 0 1 1.863.444c.654.413 1.181 1.481 1.375 2.124.248.822.42 1.7-.248 2.632-.476.662-1.864 1.028-2.986.237.3.481.705.876 1.25.95.809.11 1.577-.03 2.106-.574.452-.464.69-1.434.628-2.456l.714-.104.258 1.834 11.827-1.424zM15.05 6.848c-.034.075-.085.125-.007.37l.004.014.013.032.032.073c.14.287.295.558.552.696.067-.011.136-.019.207-.023.242-.01.395.028.492.08.009-.048.01-.119.005-.222-.018-.364.072-.982-.626-1.308-.264-.122-.634-.084-.757.068a.302.302 0 0 1 .058.013c.186.066.06.13.027.207m1.958 3.392c-.092-.05-.52-.03-.821.005-.574.068-1.193.267-1.328.372-.247.191-.135.523.047.66.511.382.96.638 1.432.575.29-.038.546-.497.728-.914.124-.288.124-.598-.058-.698m-5.077-2.942c.162-.154-.805-.355-1.556.156-.554.378-.571 1.187-.041 1.646.053.046.096.078.137.104a4.77 4.77 0 0 1 1.396-.412c.113-.125.243-.345.21-.745-.044-.542-.455-.456-.146-.749"/></svg>',
  },
  {
    slug: 'pagerduty',
    name: 'PagerDuty',
    description: 'Manage incidents and on-call schedules in PagerDuty',
    category: 'Developer Tools',
    url: 'https://mcp.pagerduty.com/v1',
    docsUrl: 'https://developer.pagerduty.com/api-reference/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#06AC38"><path d="M16.965 1.18C15.085.164 13.769 0 10.683 0H3.73v14.55h6.926c2.743 0 4.8-.164 6.61-1.37 1.975-1.303 3.004-3.484 3.004-6.007 0-2.716-1.262-4.896-3.305-5.994zm-5.5 10.326h-4.21V3.113l3.977-.027c3.62-.028 5.43 1.234 5.43 4.128 0 3.113-2.248 4.292-5.197 4.292zM3.73 17.61h3.525V24H3.73Z"/></svg>',
  },
  {
    slug: 'circleci',
    name: 'CircleCI',
    description: 'Manage CI/CD pipelines and jobs in CircleCI',
    category: 'Developer Tools',
    url: 'https://mcp.circleci.com/v1',
    docsUrl: 'https://circleci.com/docs/api/v2/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#343434"><path d="M8.963 12c0-1.584 1.284-2.855 2.855-2.855 1.572 0 2.856 1.284 2.856 2.855 0 1.572-1.284 2.856-2.856 2.856-1.57 0-2.855-1.284-2.855-2.856zm2.855-12C6.215 0 1.522 3.84.19 9.025c-.01.036-.01.07-.01.12 0 .313.252.576.575.576H5.59c.23 0 .433-.13.517-.333.997-2.16 3.18-3.672 5.712-3.672 3.466 0 6.286 2.82 6.286 6.287 0 3.47-2.82 6.29-6.29 6.29-2.53 0-4.714-1.5-5.71-3.673-.097-.19-.29-.336-.517-.336H.755c-.312 0-.575.253-.575.576 0 .037.014.072.014.12C1.514 20.16 6.214 24 11.818 24c6.624 0 12-5.375 12-12 0-6.623-5.376-12-12-12z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180" fill="#37C38F"><path d="M162 17.5406V162.5L105.812 113.897V162.5H18V17.5L162 17.5406ZM35.6515 144.901H88.1606V75.278L144.349 124.843V35.1348L35.6515 35.1037V144.901Z"/></svg>',
  },
  {
    slug: 'supabase',
    name: 'Supabase',
    description: 'Access Supabase databases and storage',
    category: 'Database',
    url: 'https://mcp.supabase.com/v1',
    docsUrl: 'https://supabase.com/docs/guides/api',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#3FCF8E"><path d="M11.9 1.036c-.015-.986-1.26-1.41-1.874-.637L.764 12.05C-.33 13.427.65 15.455 2.409 15.455h9.579l.113 7.51c.014.985 1.259 1.408 1.873.636l9.262-11.653c1.093-1.375.113-3.403-1.645-3.403h-9.642z"/></svg>',
  },
  {
    slug: 'planetscale',
    name: 'PlanetScale',
    description: 'Manage PlanetScale MySQL-compatible databases',
    category: 'Database',
    url: 'https://mcp.planetscale.com/v1',
    docsUrl: 'https://planetscale.com/docs/reference/planetscale-api-reference',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000000"><path d="M0 12C0 5.373 5.373 0 12 0c4.873 0 9.067 2.904 10.947 7.077l-15.87 15.87a11.981 11.981 0 0 1-1.935-1.099L14.99 12H12l-8.485 8.485A11.962 11.962 0 0 1 0 12Zm12.004 12L24 12.004C23.998 18.628 18.628 23.998 12.004 24Z"/></svg>',
  },
  {
    slug: 'mongodb-atlas',
    name: 'MongoDB Atlas',
    description: 'Access and manage MongoDB Atlas clusters',
    category: 'Database',
    url: 'https://mcp.mongodb.com/atlas/v1',
    docsUrl: 'https://www.mongodb.com/docs/atlas/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#47A248"><path d="M17.193 9.555c-1.264-5.58-4.252-7.414-4.573-8.115-.28-.394-.53-.954-.735-1.44-.036.495-.055.685-.523 1.184-.723.566-4.438 3.682-4.74 10.02-.282 5.912 4.27 9.435 4.888 9.884l.07.05A73.49 73.49 0 0111.91 24h.481c.114-1.032.284-2.056.51-3.07.417-.296.604-.463.85-.693a11.342 11.342 0 003.639-8.464c.01-.814-.103-1.662-.197-2.218zm-5.336 8.195s0-8.291.275-8.29c.213 0 .49 10.695.49 10.695-.381-.045-.765-1.76-.765-2.405z"/></svg>',
  },
  {
    slug: 'firebase',
    name: 'Firebase',
    description: 'Access Firebase Firestore, Auth, and other services',
    category: 'Database',
    url: 'https://mcp.firebase.google.com/v1',
    docsUrl: 'https://firebase.google.com/docs/reference/rest',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#DD2C00"><path d="M19.455 8.369c-.538-.748-1.778-2.285-3.681-4.569-.826-.991-1.535-1.832-1.884-2.245a146 146 0 0 0-.488-.576l-.207-.245-.113-.133-.022-.032-.01-.005L12.57 0l-.609.488c-1.555 1.246-2.828 2.851-3.681 4.64-.523 1.064-.864 2.105-1.043 3.176-.047.241-.088.489-.121.738-.209-.017-.421-.028-.632-.033-.018-.001-.035-.002-.059-.003a7.46 7.46 0 0 0-2.28.274l-.317.089-.163.286c-.765 1.342-1.198 2.869-1.252 4.416-.07 2.01.477 3.954 1.583 5.625 1.082 1.633 2.61 2.882 4.42 3.611l.236.095.071.025.003-.001a9.59 9.59 0 0 0 2.941.568q.171.006.342.006c1.273 0 2.513-.249 3.69-.742l.008.004.313-.145a9.63 9.63 0 0 0 3.927-3.335c1.01-1.49 1.577-3.234 1.641-5.042.075-2.161-.643-4.304-2.133-6.371m-7.083 6.695c.328 1.244.264 2.44-.191 3.558-1.135-1.12-1.967-2.352-2.475-3.665-.543-1.404-.87-2.74-.974-3.975.48.157.922.366 1.315.622 1.132.737 1.914 1.902 2.325 3.461zm.207 6.022c.482.368.99.712 1.513 1.028-.771.21-1.565.302-2.369.273a8 8 0 0 1-.373-.022c.458-.394.869-.823 1.228-1.279zm1.347-6.431c-.516-1.957-1.527-3.437-3.002-4.398-.647-.421-1.385-.741-2.194-.95.011-.134.026-.268.043-.4.014-.113.03-.216.046-.313.133-.689.332-1.37.589-2.025.099-.25.206-.499.321-.74l.004-.008c.177-.358.376-.719.61-1.105l.092-.152-.003-.001c.544-.851 1.197-1.627 1.942-2.311l.288.341c.672.796 1.304 1.548 1.878 2.237 1.291 1.549 2.966 3.583 3.612 4.48 1.277 1.771 1.893 3.579 1.83 5.375-.049 1.395-.461 2.755-1.195 3.933-.694 1.116-1.661 2.05-2.8 2.708-.636-.318-1.559-.839-2.539-1.599.79-1.575.952-3.28.479-5.072zm-2.575 5.397c-.725.939-1.587 1.55-2.09 1.856-.081-.029-.163-.06-.243-.093l-.065-.026c-1.49-.616-2.747-1.656-3.635-3.01-.907-1.384-1.356-2.993-1.298-4.653.041-1.19.338-2.327.882-3.379.316-.07.638-.114.96-.131l.084-.002c.162-.003.324-.003.478 0 .227.011.454.035.677.07.073 1.513.445 3.145 1.105 4.852.637 1.644 1.694 3.162 3.144 4.515z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#7AB55C"><path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z"/></svg>',
  },
  {
    slug: 'wordpress',
    name: 'WordPress',
    description: 'Manage WordPress posts, pages, and media',
    category: 'E-commerce & Content',
    url: 'https://mcp.wordpress.com/v1',
    docsUrl: 'https://developer.wordpress.com/docs/api/',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#21759B"><path d="M21.469 6.825c.84 1.537 1.318 3.3 1.318 5.175 0 3.979-2.156 7.456-5.363 9.325l3.295-9.527c.615-1.54.82-2.771.82-3.864 0-.405-.026-.78-.07-1.11m-7.981.105c.647-.03 1.232-.105 1.232-.105.582-.075.514-.93-.067-.899 0 0-1.755.135-2.88.135-1.064 0-2.85-.15-2.85-.15-.585-.03-.661.855-.075.885 0 0 .54.061 1.125.09l1.68 4.605-2.37 7.08L5.354 6.9c.649-.03 1.234-.1 1.234-.1.585-.075.516-.93-.065-.896 0 0-1.746.138-2.874.138-.2 0-.438-.008-.69-.015C4.911 3.15 8.235 1.215 12 1.215c2.809 0 5.365 1.072 7.286 2.833-.046-.003-.091-.009-.141-.009-1.06 0-1.812.923-1.812 1.914 0 .89.513 1.643 1.06 2.531.411.72.89 1.643.89 2.977 0 .915-.354 1.994-.821 3.479l-1.075 3.585-3.9-11.61.001.014zM12 22.784c-1.059 0-2.081-.153-3.048-.437l3.237-9.406 3.315 9.087c.024.053.05.101.078.149-1.12.393-2.325.609-3.582.609M1.211 12c0-1.564.336-3.05.935-4.39L7.29 21.709C3.694 19.96 1.212 16.271 1.211 12M12 0C5.385 0 0 5.385 0 12s5.385 12 12 12 12-5.385 12-12S18.615 0 12 0"/></svg>',
  },
  {
    slug: 'webflow',
    name: 'Webflow',
    description: 'Manage Webflow sites, collections, and items',
    category: 'E-commerce & Content',
    url: 'https://mcp.webflow.com/v1',
    docsUrl: 'https://developers.webflow.com/reference/rest-introduction',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#146EF5"><path d="m24 4.515-7.658 14.97H9.149l3.205-6.204h-.144C9.566 16.713 5.621 18.973 0 19.485v-6.118s3.596-.213 5.71-2.435H0V4.515h6.417v5.278l.144-.001 2.622-5.277h4.854v5.244h.144l2.72-5.244H24Z"/></svg>',
  },
  {
    slug: 'dropbox',
    name: 'Dropbox',
    description: 'Access and manage files in Dropbox',
    category: 'E-commerce & Content',
    url: 'https://mcp.dropbox.com/v1',
    docsUrl: 'https://www.dropbox.com/developers/documentation/http/documentation',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0061FF"><path d="M6 1.807L0 5.629l6 3.822 6.001-3.822L6 1.807zM18 1.807l-6 3.822 6 3.822 6-3.822-6-3.822zM0 13.274l6 3.822 6.001-3.822L6 9.452l-6 3.822zM18 9.452l-6 3.822 6 3.822 6-3.822-6-3.822zM6 18.371l6.001 3.822 6-3.822-6-3.822L6 18.371z"/></svg>',
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
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFD21E"><path d="M12.025 1.13c-5.77 0-10.449 4.647-10.449 10.378 0 1.112.178 2.181.503 3.185.064-.222.203-.444.416-.577a.96.96 0 0 1 .524-.15c.293 0 .584.124.84.284.278.173.48.408.71.694.226.282.458.611.684.951v-.014c.017-.324.106-.622.264-.874s.403-.487.762-.543c.3-.047.596.06.787.203s.31.313.4.467c.15.257.212.468.233.542.01.026.653 1.552 1.657 2.54.616.605 1.01 1.223 1.082 1.912.055.537-.096 1.059-.38 1.572.637.121 1.294.187 1.967.187.657 0 1.298-.063 1.921-.178-.287-.517-.44-1.041-.384-1.581.07-.69.465-1.307 1.081-1.913 1.004-.987 1.647-2.513 1.657-2.539.021-.074.083-.285.233-.542.09-.154.208-.323.4-.467a1.08 1.08 0 0 1 .787-.203c.359.056.604.29.762.543s.247.55.265.874v.015c.225-.34.457-.67.683-.952.23-.286.432-.52.71-.694.257-.16.547-.284.84-.285a.97.97 0 0 1 .524.151c.228.143.373.388.43.625l.006.04a10.3 10.3 0 0 0 .534-3.273c0-5.731-4.678-10.378-10.449-10.378M8.327 6.583a1.5 1.5 0 0 1 .713.174 1.487 1.487 0 0 1 .617 2.013c-.183.343-.762-.214-1.102-.094-.38.134-.532.914-.917.71a1.487 1.487 0 0 1 .69-2.803m7.486 0a1.487 1.487 0 0 1 .689 2.803c-.385.204-.536-.576-.916-.71-.34-.12-.92.437-1.103.094a1.487 1.487 0 0 1 .617-2.013 1.5 1.5 0 0 1 .713-.174m-10.68 1.55a.96.96 0 1 1 0 1.921.96.96 0 0 1 0-1.92m13.838 0a.96.96 0 1 1 0 1.92.96.96 0 0 1 0-1.92M8.489 11.458c.588.01 1.965 1.157 3.572 1.164 1.607-.007 2.984-1.155 3.572-1.164.196-.003.305.12.305.454 0 .886-.424 2.328-1.563 3.202-.22-.756-1.396-1.366-1.63-1.32q-.011.001-.02.006l-.044.026-.01.008-.03.024q-.018.017-.035.036l-.032.04a1 1 0 0 0-.058.09l-.014.025q-.049.088-.11.19a1 1 0 0 1-.083.116 1.2 1.2 0 0 1-.173.18q-.035.029-.075.058a1.3 1.3 0 0 1-.251-.243 1 1 0 0 1-.076-.107c-.124-.193-.177-.363-.337-.444-.034-.016-.104-.008-.2.022q-.094.03-.216.087-.06.028-.125.063l-.13.074q-.067.04-.136.086a3 3 0 0 0-.135.096 3 3 0 0 0-.26.219 2 2 0 0 0-.12.121 2 2 0 0 0-.106.128l-.002.002a2 2 0 0 0-.09.132l-.001.001a1.2 1.2 0 0 0-.105.212q-.013.036-.024.073c-1.139-.875-1.563-2.317-1.563-3.203 0-.334.109-.457.305-.454m.836 10.354c.824-1.19.766-2.082-.365-3.194-1.13-1.112-1.789-2.738-1.789-2.738s-.246-.945-.806-.858-.97 1.499.202 2.362c1.173.864-.233 1.45-.685.64-.45-.812-1.683-2.896-2.322-3.295s-1.089-.175-.938.647 2.822 2.813 2.562 3.244-1.176-.506-1.176-.506-2.866-2.567-3.49-1.898.473 1.23 2.037 2.16c1.564.932 1.686 1.178 1.464 1.53s-3.675-2.511-4-1.297c-.323 1.214 3.524 1.567 3.287 2.405-.238.839-2.71-1.587-3.216-.642-.506.946 3.49 2.056 3.522 2.064 1.29.33 4.568 1.028 5.713-.624m5.349 0c-.824-1.19-.766-2.082.365-3.194 1.13-1.112 1.789-2.738 1.789-2.738s.246-.945.806-.858.97 1.499-.202 2.362c-1.173.864.233 1.45.685.64.451-.812 1.683-2.896 2.322-3.295s1.089-.175.938.647-2.822 2.813-2.562 3.244 1.176-.506 1.176-.506 2.866-2.567 3.49-1.898-.473 1.23-2.037 2.16c-1.564.932-1.686 1.178-1.464 1.53s3.675-2.511 4-1.297c.323 1.214-3.524 1.567-3.287 2.405.238.839 2.71-1.587 3.216-.642.506.946-3.49 2.056-3.522 2.064-1.29.33-4.568 1.028-5.713-.624"/></svg>',
  },
  {
    slug: 'replicate',
    name: 'Replicate',
    description: 'Run machine learning models on Replicate',
    category: 'AI/ML',
    url: 'https://mcp.replicate.com/v1',
    docsUrl: 'https://replicate.com/docs/reference/http',
    requiresToken: true,
    logoSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#000000"><path d="M24 10.262v2.712h-9.518V24h-3.034V10.262zm0-5.131v2.717H8.755V24H5.722V5.131zM24 0v2.717H3.034V24H0V0z"/></svg>',
  },
];

export const CATALOG_SLUGS: Set<string> = new Set(REMOTE_MCP_CATALOG.map(e => e.slug));

// Same path as pi-mcp-adapter's DEFAULT_CONFIG_PATH (~/.pi/agent/mcp.json).
// pi-mcp-adapter does not export this constant so we duplicate it here.
const MCP_CONFIG_PATH = join(homedir(), '.pi', 'agent', 'mcp.json');

export { keychainGet, keychainSet, keychainDelete };

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
  const LLM_OAUTH_IDS = new Set([
    'anthropic', 'github-copilot', 'google-gemini-cli', 'google-antigravity', 'openai-codex',
  ]);

  const oauthConnectors: ConnectorEntry[] = getOAuthProviders()
    .filter((p) => !LLM_OAUTH_IDS.has(p.id))
    .map((p) => ({
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

  // 3. Catalog entries — determine status via mcp.json + keychain (parallel lookups)
  let keychainFailed = false;
  const tokenResults = await Promise.all(
    REMOTE_MCP_CATALOG.map((entry) =>
      entry.requiresToken
        ? keychainGet(entry.slug).catch(() => { keychainFailed = true; return null; })
        : Promise.resolve(null)
    )
  );

  const remoteMcpConnectors: ConnectorEntry[] = REMOTE_MCP_CATALOG.map((entry, i) => {
    const inMcp = entry.slug in mcpServers;
    let status: 'connected' | 'available' = 'available';

    if (!entry.requiresToken) {
      status = inMcp ? 'connected' : 'available';
    } else {
      const token = tokenResults[i];
      if (inMcp && token) {
        status = 'connected';
      } else if (!inMcp && token) {
        // Stale keychain entry — no mcp.json record; silently delete it
        keychainDelete(entry.slug).catch(err =>
          console.warn(`[connectors] Failed to delete stale keychain entry remote-mcp/${entry.slug}:`, err)
        );
      }
    }

    return {
      id: `remote-mcp/${entry.slug}`,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      type: 'remote-mcp' as const,
      status,
      logoSvg: entry.logoSvg,
      url: entry.url,
      docsUrl: entry.docsUrl,
      requiresToken: entry.requiresToken,
    };
  });

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

/**
 * Returns true if the URL hostname resolves to a private, loopback, or link-local
 * address by hostname string analysis (no DNS lookup).
 * Prevents SSRF: a crafted URL could send the user's MCP auth token to an attacker-
 * controlled service running on localhost or the local network.
 */
function isPrivateOrLocalhostUrl(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString);
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
    if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true;
    if (/^127\./.test(h) || h === '0.0.0.0') return true;
    if (/^169\.254\./.test(h)) return true;   // AWS/Azure metadata / link-local
    if (/^10\./.test(h)) return true;          // RFC 1918
    if (/^192\.168\./.test(h)) return true;    // RFC 1918
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true; // RFC 1918
    return false;
  } catch {
    return true; // Unparseable URL — reject
  }
}

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
  if (isPrivateOrLocalhostUrl(trimmedUrl)) {
    return { error: { field: 'url', message: 'Private and localhost URLs are not allowed for remote MCP servers', status: 400 } };
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
