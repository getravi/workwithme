import { existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  category: string;
  source: 'user' | 'example';
  path: string;
}

const SLUG_TO_CATEGORY: Record<string, string> = {
  // Engineering
  'code-review': 'Engineering', 'debug': 'Engineering', 'architecture': 'Engineering',
  'system-design': 'Engineering', 'testing-strategy': 'Engineering', 'deploy-checklist': 'Engineering',
  'documentation': 'Engineering', 'tech-debt': 'Engineering', 'incident-response': 'Engineering',
  'standup': 'Engineering', 'debug-error': 'Engineering',
  // Data
  'analyze': 'Data', 'build-dashboard': 'Data', 'create-viz': 'Data',
  'data-context-extractor': 'Data', 'data-visualization': 'Data', 'explore-data': 'Data',
  'sql-queries': 'Data', 'statistical-analysis': 'Data', 'validate-data': 'Data', 'write-query': 'Data',
  // Design
  'accessibility-review': 'Design', 'design-critique': 'Design', 'design-handoff': 'Design',
  'design-system': 'Design', 'research-synthesis': 'Design', 'user-research': 'Design', 'ux-copy': 'Design',
  'code-connect-components': 'Design', 'create-design-system-rules': 'Design', 'implement-design': 'Design',
  'branded-presentation': 'Design', 'design-translation': 'Design', 'implement-feedback': 'Design',
  'resize-for-social-media': 'Design',
  // Finance
  'audit-support': 'Finance', 'close-management': 'Finance', 'financial-statements': 'Finance',
  'journal-entry-prep': 'Finance', 'journal-entry': 'Finance', 'reconciliation': 'Finance',
  'sox-testing': 'Finance', 'variance-analysis': 'Finance',
  // Human Resources
  'comp-analysis': 'Human Resources', 'draft-offer': 'Human Resources', 'interview-prep': 'Human Resources',
  'onboarding': 'Human Resources', 'org-planning': 'Human Resources', 'people-report': 'Human Resources',
  'performance-review': 'Human Resources', 'policy-lookup': 'Human Resources', 'recruiting-pipeline': 'Human Resources',
  // Legal
  'brief': 'Legal', 'compliance-check': 'Legal', 'legal-response': 'Legal',
  'legal-risk-assessment': 'Legal', 'meeting-briefing': 'Legal', 'review-contract': 'Legal',
  'signature-request': 'Legal', 'triage-nda': 'Legal', 'vendor-check': 'Legal',
  // Marketing
  'brand-review': 'Marketing', 'campaign-plan': 'Marketing', 'marketing-competitive-brief': 'Marketing',
  'anthropics-competitive-brief': 'Marketing', 'content-creation': 'Marketing', 'draft-content': 'Marketing',
  'email-sequence': 'Marketing', 'performance-report': 'Marketing', 'seo-audit': 'Marketing',
  'brand-voice-enforcement': 'Marketing', 'discover-brand': 'Marketing', 'guideline-generation': 'Marketing',
  // Operations
  'capacity-plan': 'Operations', 'change-request': 'Operations', 'compliance-tracking': 'Operations',
  'process-doc': 'Operations', 'process-optimization': 'Operations', 'risk-assessment': 'Operations',
  'runbook': 'Operations', 'status-report': 'Operations', 'vendor-review': 'Operations',
  // Product
  'metrics-review': 'Product', 'product-brainstorming': 'Product', 'product-management-competitive-brief': 'Product',
  'roadmap-update': 'Product', 'sprint-planning': 'Product', 'stakeholder-update': 'Product',
  'synthesize-research': 'Product', 'write-spec': 'Product',
  // Sales
  'sales-account-research': 'Sales', 'common-room-account-research': 'Sales', 'account-research': 'Sales',
  'sales-call-prep': 'Sales', 'common-room-call-prep': 'Sales', 'call-prep': 'Sales',
  'call-summary': 'Sales', 'competitive-intelligence': 'Sales', 'create-an-asset': 'Sales',
  'daily-briefing': 'Sales', 'draft-outreach': 'Sales', 'forecast': 'Sales', 'pipeline-review': 'Sales',
  'compose-outreach': 'Sales', 'contact-research': 'Sales', 'common-room-prospect': 'Sales',
  'weekly-prep-brief': 'Sales', 'enrich-lead': 'Sales', 'apollo-prospect': 'Sales', 'sequence-load': 'Sales',
  // Customer Support
  'customer-escalation': 'Customer Support', 'customer-research': 'Customer Support',
  'draft-response': 'Customer Support', 'kb-article': 'Customer Support', 'ticket-triage': 'Customer Support',
  // Enterprise Search
  'digest': 'Enterprise Search', 'knowledge-synthesis': 'Enterprise Search',
  'search-strategy': 'Enterprise Search', 'search': 'Enterprise Search', 'source-management': 'Enterprise Search',
  // Bio Research
  'instrument-data-to-allotrope': 'Bio Research', 'nextflow-development': 'Bio Research',
  'scientific-problem-selection': 'Bio Research', 'scvi-tools': 'Bio Research', 'single-cell-rna-qc': 'Bio Research',
  // Audio
  'agents': 'Audio', 'music': 'Audio', 'setup-api-key': 'Audio',
  'sound-effects': 'Audio', 'speech-to-text': 'Audio', 'text-to-speech': 'Audio',
  // Database
  'mysql': 'Database', 'postgres': 'Database', 'neki': 'Database', 'vitess': 'Database',
  // Productivity
  'memory-management': 'Productivity', 'task-management': 'Productivity', 'update': 'Productivity',
  'anthropics-start': 'Productivity', 'productivity-start': 'Productivity', 'bio-research-start': 'Productivity',
  'cowork-plugin-customizer': 'Productivity', 'create-cowork-plugin': 'Productivity',
  // Communication
  'slack-messaging': 'Communication', 'slack-search': 'Communication',
};

function deriveCategory(slug: string, frontmatterCategory?: string): string {
  if (frontmatterCategory) return frontmatterCategory;
  if (SLUG_TO_CATEGORY[slug]) return SLUG_TO_CATEGORY[slug];
  if (slug.startsWith('gws-') || slug.startsWith('recipe-') || slug.startsWith('persona-')) return 'Google Workspace';
  if (slug.startsWith('azure-') || slug.startsWith('appinsights') || slug.startsWith('entra-') || slug.startsWith('microsoft-')) return 'Azure';
  return 'Other';
}

function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const raw = line.slice(colonIndex + 1).trim();
    const value = raw.replace(/^["']|["']$/g, '');
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
        category: deriveCategory(slug, fm.category),
        source,
        path: filePath,
      });
    } catch (err) {
      console.warn(`[skills] Failed to read ${file}:`, err);
    }
  }
  return entries;
}

// Built-in example skills — inlined so they work in both dev and compiled binary.
const BUILTIN_EXAMPLES: SkillEntry[] = [
  {
    id: 'example/code-review',
    name: 'code-review',
    description: 'Review code for bugs, style issues, and improvements. Use when the user asks to review, check, or critique code.',
    category: 'Engineering',
    source: 'example',
    path: '',
  },
  {
    id: 'example/debug-error',
    name: 'debug-error',
    description: 'Systematically diagnose and fix errors or unexpected behavior. Use when the user reports a bug, error message, or unexpected output.',
    category: 'Engineering',
    source: 'example',
    path: '',
  },
];

export const USER_SKILLS_DIR = join(homedir(), '.config', 'workwithme', 'skills');

export function listSkills(): SkillEntry[] {
  return [
    ...BUILTIN_EXAMPLES,
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

export function getSkillContent(source: string, slug: string): string | null {
  if (source === 'example') {
    const example = BUILTIN_EXAMPLES.find((e) => e.id === `example/${slug}`);
    if (!example) return null;
    // Return a minimal representation for built-in examples that have no file
    return `---\nname: ${example.name}\ndescription: ${example.description}\n---\n\n${example.description}`;
  }
  if (source === 'user') {
    const filePath = join(USER_SKILLS_DIR, `${slug}.md`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  }
  return null;
}

export function writeUserSkill(name: string, content: string): string {
  const safeName = sanitizeSkillName(name);
  if (!safeName) throw new Error('Invalid skill name: must contain alphanumeric characters');
  if (!existsSync(USER_SKILLS_DIR)) {
    mkdirSync(USER_SKILLS_DIR, { recursive: true });
  }
  const filePath = join(USER_SKILLS_DIR, `${safeName}.md`);
  if (existsSync(filePath)) throw new Error(`Skill already exists: ${safeName}`);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}
