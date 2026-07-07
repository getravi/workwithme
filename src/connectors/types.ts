// ── Types ────────────────────────────────────────────────────────────────────

export interface ConnectorEntry {
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

export interface GetConnectorsResponse {
  connectors: ConnectorEntry[];
  warning?: string;
}

export type FilterTab = "all" | "connected" | "available";

// ── Constants ────────────────────────────────────────────────────────────────

export const CATEGORIES = [
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

export const ICON_COLORS: Record<string, string> = {
  anthropic: "bg-[#cc5500]",
  google: "bg-[#4285f4]",
  github: "bg-[#24292e]",
  openai: "bg-[#10a37f]",
};

export const TIMEOUT_MS = 30_000;
