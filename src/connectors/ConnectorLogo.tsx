import DOMPurify from "dompurify";
import type { ConnectorEntry } from "./types";
import { ICON_COLORS } from "./types";

// ── ConnectorLogo ────────────────────────────────────────────────────────────

const LOGO_CONTAINER = "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0";

export function ConnectorLogo({ entry }: { entry: ConnectorEntry }) {
  if (entry.logoSvg) {
    return (
      <div
        className={`${LOGO_CONTAINER} bg-white/5 p-1.5 [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full`}
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(entry.logoSvg, { USE_PROFILES: { svg: true } }) }}
      />
    );
  }
  const bg = ICON_COLORS[entry.name.toLowerCase()] ?? "bg-[#374151]";
  return (
    <div className={`${LOGO_CONTAINER} ${bg} text-white font-bold text-[14px]`}>
      {entry.name.charAt(0).toUpperCase()}
    </div>
  );
}

// ── StatusDot ────────────────────────────────────────────────────────────────

export function StatusDot({ status }: { status: "connected" | "available" }) {
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <div className={`w-1.5 h-1.5 rounded-full ${status === "connected" ? "bg-green-500" : "bg-gray-600"}`} />
      <span className={`text-[12px] font-medium ${status === "connected" ? "text-green-400" : "text-gray-500"}`}>
        {status === "connected" ? "Connected" : "Available"}
      </span>
    </div>
  );
}
