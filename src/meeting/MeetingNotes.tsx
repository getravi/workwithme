interface MeetingNotesProps {
  notes: string;
  onNotesChange: (value: string) => void;
}

export function MeetingNotes({ notes, onNotesChange }: MeetingNotesProps) {
  return (
    <div className="flex-1 flex flex-col border-r border-[#1f2937] p-[16px]">
      <label className="text-[11px] text-[#9ca3af] mb-[6px] uppercase tracking-[0.05em]">
        Notes
      </label>
      <textarea
        value={notes}
        onChange={(e) => onNotesChange(e.target.value)}
        placeholder="Type rough notes here…"
        className="flex-1 bg-[#182234] border border-[#374151] rounded-[6px] text-[#f3f4f6] text-[13px] p-[12px] resize-none outline-none leading-[1.5]"
      />
    </div>
  );
}
