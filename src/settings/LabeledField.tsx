import type { ReactNode } from "react";

interface LabeledFieldProps {
  label: ReactNode;
  children: ReactNode;
}

// Label + control pair used by the settings forms.
export function LabeledField({ label, children }: LabeledFieldProps) {
  return (
    <div className="space-y-1.5">
      <label className="text-[12px] font-medium text-gray-400">{label}</label>
      {children}
    </div>
  );
}
