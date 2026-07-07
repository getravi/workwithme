interface MeetingIdlePanelProps {
  title: string;
  onTitleChange: (value: string) => void;
  onStart: () => void;
  error: string | null;
}

export function MeetingIdlePanel({ title, onTitleChange, onStart, error }: MeetingIdlePanelProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-[16px] p-[32px]">
      <input
        type="text"
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && onStart()}
        placeholder="Meeting title…"
        className="bg-[#1f2937] border border-[#374151] rounded-[8px] text-[#f3f4f6] text-[16px] py-[10px] px-[16px] w-full max-w-[400px] outline-none"
      />
      <button
        onClick={onStart}
        className="bg-[#4f46e5] border-none rounded-[8px] text-white text-[15px] font-semibold py-[10px] px-[28px] cursor-pointer w-full max-w-[400px]"
      >
        Start Recording
      </button>
      {error && <p className="text-[#f87171] text-[13px]">{error}</p>}
    </div>
  );
}
