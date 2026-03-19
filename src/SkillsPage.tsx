import { useState, useEffect, useCallback } from "react";
import { Zap, Search, Plus, ChevronDown, X } from "lucide-react";
import { API_BASE } from "./config";
import { MarkdownMessage } from "./MarkdownMessage";

interface SkillEntry {
  id: string;
  name: string;
  description: string;
  category: string;
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
        <h3 className="text-[16px] font-semibold text-gray-100">Create skill</h3>
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-[12px] text-gray-400 mb-1 block">Name</label>
            <input
              className="w-full bg-[#1f2937] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-100 focus:outline-none focus:border-[#c5f016]/50"
              placeholder="e.g. code-review"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[12px] text-gray-400 mb-1 block">Description</label>
            <input
              className="w-full bg-[#1f2937] border border-[#374151] rounded-lg px-3 py-2 text-[13px] text-gray-100 focus:outline-none focus:border-[#c5f016]/50"
              placeholder="What this skill does and when to use it"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[12px] text-gray-400 mb-1 block">Content</label>
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

function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
}

interface SkillDetailPanelProps {
  skill: SkillEntry;
  onClose: () => void;
}

function SkillDetailPanel({ skill, onClose }: SkillDetailPanelProps) {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const [source, slug] = skill.id.split("/");
    fetch(`${API_BASE}/api/skills/${source}/${slug}`)
      .then((r) => r.ok ? r.json() : r.json().then((e: { error: string }) => Promise.reject(e.error)))
      .then((data: { content: string }) => setContent(data.content))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [skill.id]);

  return (
    <div className="flex flex-col h-full bg-[#0e1623] border-l border-[#1f2937] w-[420px] shrink-0">
      {/* Panel header */}
      <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-[#1f2937]">
        <div className="min-w-0 pr-3">
          <p className="text-[14px] font-semibold text-gray-100 truncate">{skill.name}</p>
          <p className="text-[12px] text-gray-500 mt-0.5">{skill.category}</p>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors mt-0.5 shrink-0">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Description */}
      {skill.description && (
        <div className="px-5 py-3 border-b border-[#1f2937]">
          <p className="text-[12px] text-gray-400 leading-relaxed">{skill.description}</p>
        </div>
      )}

      {/* Source badge */}
      <div className="px-5 py-2.5 border-b border-[#1f2937]">
        <span className={`text-[12px] px-1.5 py-0.5 rounded font-medium ${
          skill.source === "user" ? "bg-[#c5f016]/10 text-[#c5f016]" : "bg-[#1f2937] text-gray-500"
        }`}>
          {skill.source === "user" ? "My skill" : "Example"}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && (
          <div className="space-y-2">
            {[80, 60, 90, 50].map((w, i) => (
              <div key={i} className="h-3 rounded bg-[#1a2640] animate-pulse" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {error && <p className="text-red-400 text-[12px]">{error}</p>}
        {!loading && !error && content !== null && (
          <MarkdownMessage content={stripFrontmatter(content)} isStreaming={false} />
        )}
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
  const [category, setCategory] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillEntry | null>(null);

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

  // Sorted unique categories
  const categories = Array.from(new Set(skills.map((s) => s.category))).sort();

  const filtered = skills.filter((s) => {
    if (tab === "user" && s.source !== "user") return false;
    if (tab === "example" && s.source !== "example") return false;
    if (category !== "all" && s.category !== category) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by category
  const grouped = filtered.reduce<Record<string, SkillEntry[]>>((acc, s) => {
    (acc[s.category] ??= []).push(s);
    return acc;
  }, {});
  const groupKeys = Object.keys(grouped).sort((a, b) => grouped[b].length - grouped[a].length);

  return (
    <div className="flex-1 flex bg-[#111827] overflow-hidden">
    <div className="flex-1 flex flex-col overflow-hidden">
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

      {/* Filters row */}
      <div className="px-6 pb-3 flex items-center gap-3">
        {/* Source tabs */}
        <div className="flex items-center gap-2">
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

        {/* Divider */}
        <div className="w-px h-4 bg-[#374151]" />

        {/* Category dropdown */}
        <div className="relative">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="appearance-none bg-[#1f2937] border border-[#374151] rounded-lg pl-3 pr-7 py-1 text-[12px] text-gray-300 focus:outline-none focus:border-[#c5f016]/50 cursor-pointer"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <ChevronDown className="w-3 h-3 absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
        </div>

        {/* Count */}
        {!loading && (
          <span className="text-[12px] text-gray-600 ml-auto">
            {filtered.length} skill{filtered.length !== 1 ? "s" : ""}
          </span>
        )}
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
          <div className="flex flex-col gap-6">
            {groupKeys.map((cat) => (
              <div key={cat}>
                <h2 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wider mb-2.5">
                  {cat}
                  <span className="ml-2 text-gray-600 normal-case font-normal tracking-normal">
                    ({grouped[cat].length})
                  </span>
                </h2>
                <div className="grid grid-cols-2 gap-3">
                  {grouped[cat].map((skill) => (
                    <div
                      key={skill.id}
                      onClick={() => setSelectedSkill(selectedSkill?.id === skill.id ? null : skill)}
                      className={`bg-[#141d2e] border rounded-xl p-4 cursor-pointer transition-colors ${
                        selectedSkill?.id === skill.id
                          ? "border-[#c5f016]/40 bg-[#1a2a10]"
                          : "border-[#1f2937] hover:border-[#374151]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-gray-100 truncate">{skill.name}</p>
                          <p className="text-[12px] text-gray-500 mt-1 line-clamp-2 leading-relaxed">{skill.description}</p>
                        </div>
                      </div>
                      <div className="mt-2">
                        <span className={`text-[12px] px-1.5 py-0.5 rounded font-medium ${
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

    {/* Detail panel */}
    {selectedSkill && (
      <SkillDetailPanel
        skill={selectedSkill}
        onClose={() => setSelectedSkill(null)}
      />
    )}
    </div>
  );
}
