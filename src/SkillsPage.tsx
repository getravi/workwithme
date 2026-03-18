import { useState, useEffect, useCallback } from "react";
import { Zap, Search, Plus } from "lucide-react";
import { API_BASE } from "./config";

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: "user" | "example";
  path: string;
}

interface CreateSkillModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function CreateSkillModal({ onClose, onCreated }: CreateSkillModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!name.trim()) { setError("Name is required"); return; }
    if (/[\r\n]/.test(name) || /[\r\n]/.test(description)) {
      setError("Name and description cannot contain newlines");
      return;
    }
    setSaving(true);
    setError(null);
    const content = `---\nname: ${name.trim()}\ndescription: ${description.trim()}\n---\n\n${body}`;
    try {
      const res = await fetch(`${API_BASE}/api/skills`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), content }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to create skill");
      onCreated();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-[#141d2e] border border-[#1f2937] rounded-xl p-6 w-full max-w-lg flex flex-col gap-4">
        <h3 className="text-[15px] font-semibold text-gray-100">Create skill</h3>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">Name</label>
            <input
              className="w-full bg-[#1f2937] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-100 focus:outline-none focus:border-[#c5f016]/50"
              placeholder="e.g. code-review"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">Description</label>
            <input
              className="w-full bg-[#1f2937] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-100 focus:outline-none focus:border-[#c5f016]/50"
              placeholder="What this skill does and when to use it"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] text-gray-400 mb-1 block">Content</label>
            <textarea
              className="w-full bg-[#1f2937] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-100 focus:outline-none focus:border-[#c5f016]/50 resize-none font-mono"
              rows={6}
              placeholder="Skill instructions..."
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>
        {error && <p className="text-red-400 text-[12px]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-[13px] text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-[#c5f016] text-black text-[13px] font-semibold disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving…" : "Save skill"}
          </button>
        </div>
      </div>
    </div>
  );
}

type FilterTab = "all" | "user" | "example";

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [showCreate, setShowCreate] = useState(false);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSkills(await res.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);

  const filtered = skills.filter((s) => {
    if (tab === "user" && s.source !== "user") return false;
    if (tab === "example" && s.source !== "example") return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="flex-1 flex flex-col bg-[#111827] overflow-hidden">
      {/* Header */}
      <div className="px-6 pt-5 pb-3 flex items-center justify-between border-b border-[#1f2937]">
        <h1 className="text-[18px] font-semibold text-gray-100 flex items-center gap-2">
          <Zap className="w-5 h-5 text-[#c5f016]" />
          Skills
        </h1>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              className="bg-[#1f2937] border border-[#374151] rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-gray-200 placeholder-gray-500 focus:outline-none focus:border-[#c5f016]/50 w-52"
              placeholder="Search skills"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#c5f016] text-black text-[12px] font-semibold hover:bg-[#d4f518] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create skill
          </button>
        </div>
      </div>

      {/* Tagline */}
      <div className="px-6 py-3 text-[13px] text-gray-400">
        Extend what the agent can do with reusable skill files. Skills are applied automatically when relevant.
      </div>

      {/* Filter tabs */}
      <div className="px-6 pb-3 flex items-center gap-2">
        {(["all", "user", "example"] as FilterTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1 rounded-full text-[12px] font-medium transition-colors border ${
              tab === t
                ? "bg-[#374151] text-gray-100 border-[#4b5563]"
                : "border-[#374151] text-gray-500 hover:text-gray-300"
            }`}
          >
            {t === "all" ? "All" : t === "user" ? "My skills" : "Example skills"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading && (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[88px] rounded-xl bg-[#1a2640] animate-pulse border border-[#1f2937]" />
            ))}
          </div>
        )}
        {!loading && error && (
          <div className="flex items-center justify-center h-40 text-red-400 text-[13px]">{error}</div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="flex items-center justify-center h-40 text-gray-500 text-[13px]">
            {search ? "No skills match your search." : "No skills yet. Create your first skill to get started."}
          </div>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((skill) => (
              <div
                key={skill.id}
                className="bg-[#141d2e] border border-[#1f2937] rounded-xl p-4 hover:border-[#374151] transition-colors group relative"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-gray-100 truncate">{skill.name}</p>
                    <p className="text-[12px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">{skill.description}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    skill.source === "user"
                      ? "bg-[#c5f016]/10 text-[#c5f016]"
                      : "bg-[#1f2937] text-gray-500"
                  }`}>
                    {skill.source === "user" ? "My skill" : "Example"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateSkillModal
          onClose={() => setShowCreate(false)}
          onCreated={fetchSkills}
        />
      )}
    </div>
  );
}
