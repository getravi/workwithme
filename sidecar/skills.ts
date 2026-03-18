import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  source: 'user' | 'example';
  path: string;
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function scanSkillsDir(dir: string, source: 'user' | 'example'): SkillEntry[] {
  if (!existsSync(dir)) return [];
  const entries: SkillEntry[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.md')) continue;
    const filePath = join(dir, file);
    try {
      const content = readFileSync(filePath, 'utf-8');
      const fm = parseFrontmatter(content);
      if (!fm?.name) {
        console.warn(`[skills] Skipping ${file}: missing 'name' in frontmatter`);
        continue;
      }
      const slug = basename(file, '.md');
      entries.push({
        id: `${source}/${slug}`,
        name: fm.name,
        description: fm.description ?? '',
        source,
        path: filePath,
      });
    } catch (err) {
      console.warn(`[skills] Failed to read ${file}:`, err);
    }
  }
  return entries;
}

const EXAMPLES_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'skills', 'examples');
export const USER_SKILLS_DIR = join(homedir(), '.config', 'workwithme', 'skills');

export function listSkills(): SkillEntry[] {
  return [
    ...scanSkillsDir(EXAMPLES_DIR, 'example'),
    ...scanSkillsDir(USER_SKILLS_DIR, 'user'),
  ];
}

export function sanitizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function writeUserSkill(name: string, content: string): string {
  const safeName = sanitizeSkillName(name);
  if (!safeName) throw new Error('Invalid skill name: must contain alphanumeric characters');
  if (!existsSync(USER_SKILLS_DIR)) {
    mkdirSync(USER_SKILLS_DIR, { recursive: true });
  }
  const filePath = join(USER_SKILLS_DIR, `${safeName}.md`);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
