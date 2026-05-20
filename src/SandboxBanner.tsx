import { X } from "lucide-react";
import { useUI } from "./context/UIContext";

export function SandboxBanner() {
  const { sandboxStatus, sandboxBannerDismissed, setSandboxBannerDismissed } = useUI();

  if (!sandboxStatus || sandboxStatus.active || sandboxBannerDismissed) return null;

  return (
    <div className="absolute top-14 left-0 right-0 z-20 mx-3">
      <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400 text-[12px]">
        <span className="flex-shrink-0 mt-0.5" aria-hidden="true">⚠</span>
        <span className="flex-1">
          {sandboxStatus.warning ?? "Sandboxing is inactive."}{" "}
          <a
            href="https://github.com/anthropic-experimental/sandbox-runtime"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-300"
          >
            Learn more
          </a>
        </span>
        <button
          type="button"
          onClick={() => setSandboxBannerDismissed(true)}
          className="flex-shrink-0 p-0.5 hover:text-white transition-colors"
          aria-label="Dismiss sandbox warning"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
