import { Loader2 } from "lucide-react";

interface StatusIndicatorProps {
  status?: string;
  isStreaming?: boolean;
  toolName?: string;
}

const TOOL_STATUS_MAP: Record<string, string> = {
  read_file: "Reading files",
  glob: "Finding files",
  grep: "Searching codebase",
  web_search: "Searching the web",
  web_fetch: "Fetching content",
  bash: "Running commands",
  shell: "Running commands",
  write_file: "Writing files",
  edit_file: "Editing files",
  create_file: "Creating files",
  mcp__filesystem__read_file: "Reading files",
  mcp__filesystem__write_file: "Writing files",
  mcp__filesystem__list_directory: "Listing directory",
  mcp__search__search: "Searching",
};

function deriveStatusFromTool(toolName: string): string | null {
  const normalized = toolName.toLowerCase().replace(/_/g, "-");
  for (const [key, status] of Object.entries(TOOL_STATUS_MAP)) {
    if (normalized.includes(key) || key.includes(normalized.split("-")[0])) {
      return status;
    }
  }
  return null;
}

export function StatusIndicator({ status, isStreaming, toolName }: StatusIndicatorProps) {
  const displayStatus = status || (toolName ? deriveStatusFromTool(toolName) : null);

  if (!isStreaming && !displayStatus) return null;

  return (
    <div className="flex items-center gap-2 mb-2 text-[12px] text-gray-500">
      <Loader2 className="w-3 h-3 animate-spin text-[#c5f016]" />
      <span>{displayStatus || "Working…"}</span>
    </div>
  );
}
