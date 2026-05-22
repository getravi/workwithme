import { ChevronDown } from "lucide-react";
import type { Model } from "./types";

export function ModelSelector({
  selected,
  models,
  onChange,
}: {
  selected: Model | null;
  models: Model[];
  onChange: (model: Model) => void;
}) {
  if (models.length === 0) return null;
  return (
    <div className="relative flex items-center bg-[#182234] border border-[#1f2937] rounded-lg shadow-sm hover:border-[#374151] transition-colors focus-within:border-[#c5f016]/50">
      <select
        value={selected ? `${selected.provider}:${selected.id}` : ""}
        onChange={(e) => {
          const m = models.find((m) => `${m.provider}:${m.id}` === e.target.value);
          if (m) onChange(m);
        }}
        className="appearance-none bg-transparent py-1.5 pl-2.5 pr-7 text-[13px] font-medium text-gray-300 focus:outline-none focus:text-white cursor-pointer w-full z-10"
      >
        {models.map((m) => (
          <option key={`${m.provider}:${m.id}`} value={`${m.provider}:${m.id}`} className="bg-[#182234] text-gray-200">
            {m.name ?? `${m.provider}/${m.id}`}
          </option>
        ))}
      </select>
      <ChevronDown className="w-3.5 h-3.5 opacity-50 absolute right-2 pointer-events-none text-gray-400" />
    </div>
  );
}
