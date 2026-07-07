const SHORTCUTS: { keys: string[]; description: string; category: string }[] = [
  { category: "Chat", keys: ["Enter"], description: "Send message" },
  { category: "Chat", keys: ["Shift", "Enter"], description: "New line in message" },
  { category: "Chat", keys: ["⌘", "N"], description: "New chat" },
  { category: "Navigation", keys: ["⌘", ","], description: "Open settings" },
  { category: "Navigation", keys: ["⌘", "\\"], description: "Toggle sidebar" },
  { category: "Input", keys: ["⌘", "V"], description: "Paste image or text from clipboard" },
  { category: "Screenshot", keys: ["⌘", "⌃", "4"], description: "Capture screen region" },
  { category: "Screenshot", keys: ["⌘", "⌃", "5"], description: "Capture window" },
  { category: "Voice", keys: ["⌘", "⇧", "Space"], description: "Dictate (type into active window)" },
  { category: "Voice", keys: ["⌘", "⌃", "7"], description: "New meeting" },
  { category: "Voice", keys: ["⌘", "⌃", "6"], description: "Record screen" },
];

export function ShortcutsTab() {
  const categories = [...new Set(SHORTCUTS.map((s) => s.category))];
  return (
    <div className="p-4 max-w-lg">
      <p className="text-[13px] text-gray-500 mb-4">Keyboard shortcuts for Work With Me.</p>
      <div className="space-y-5">
        {categories.map((cat) => (
          <section key={cat}>
            <h3 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{cat}</h3>
            <div className="space-y-1">
              {SHORTCUTS.filter((s) => s.category === cat).map((s, i) => (
                <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-[#1f2937]/50">
                  <span className="text-[13px] text-gray-300">{s.description}</span>
                  <div className="flex items-center gap-1">
                    {s.keys.map((k, ki) => (
                      <kbd key={ki} className="px-1.5 py-0.5 bg-[#111827] border border-[#374151] rounded text-[11px] text-gray-300 font-mono">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
