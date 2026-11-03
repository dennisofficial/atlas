export enum ESkillOwner {
  Global = 'global',
  Project = 'project',
}

export const SKILL_OWNER_LABELS: Record<ESkillOwner, string> = {
  [ESkillOwner.Global]: 'Global',
  [ESkillOwner.Project]: 'Project',
}

export const SKILL_PRECEDENCE_COPY =
  'In a session, a skill in the repository overrides a project skill, which overrides a global skill with the same name.'

export enum ESkillFileKind {
  Text = 'text',
  Binary = 'binary',
}

export type SkillFile = {
  path: string
  kind: ESkillFileKind
  content: string
}

export type Skill = {
  name: string
  description: string
  owner: ESkillOwner
  files: SkillFile[]
  updatedAt: string
}

const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.ts', '.tsx', '.js', '.json', '.yaml', '.yml'])

export function fileKindOf(path: string): ESkillFileKind {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return TEXT_EXTENSIONS.has(ext) ? ESkillFileKind.Text : ESkillFileKind.Binary
}

const SKILL_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatSkillDate(updatedAt: string): string {
  return SKILL_DATE_FORMAT.format(new Date(updatedAt))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatSkillSize(files: SkillFile[]): string {
  return formatBytes(files.reduce((total, file) => total + new Blob([file.content]).size, 0))
}

export function formatFileSize(file: SkillFile): string {
  return formatBytes(new Blob([file.content]).size)
}

function skillMd({ name, description }: { name: string; description: string }) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nWhen to use this skill, and how it behaves, go here.\n`
}

function textFile(path: string, content: string): SkillFile {
  return { path, kind: ESkillFileKind.Text, content }
}

function binaryFile(path: string, byteLength: number): SkillFile {
  return { path, kind: ESkillFileKind.Binary, content: 'x'.repeat(byteLength) }
}

function skill({
  name,
  description,
  owner,
  files = [],
  updatedAt,
}: {
  name: string
  description: string
  owner: ESkillOwner
  files?: SkillFile[]
  updatedAt: string
}): Skill {
  return {
    name,
    description,
    owner,
    updatedAt,
    files: [textFile('SKILL.md', skillMd({ name, description })), ...files],
  }
}

export const GLOBAL_SKILLS: Skill[] = [
  skill({
    name: 'ui-design',
    description: 'Default guidance for every UI task: layout, spacing, hierarchy, typography.',
    owner: ESkillOwner.Global,
    files: [
      textFile(
        'references/type-scale.md',
        '# Type scale\n\nPick a practical scale and constrain it deliberately.\n',
      ),
      textFile(
        'references/empty-states.md',
        '# Empty states\n\nTeach and guide instead of showing a blank screen.\n',
      ),
    ],
    updatedAt: '2026-11-02T09:00:00Z',
  }),
  skill({
    name: 'code-comments',
    description: 'Write code that reads like English; comments only for what code cannot say.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-10-28T14:20:00Z',
  }),
  skill({
    name: 'tdd',
    description: 'Test-driven development: red-green-refactor for features and bug fixes.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-10-24T11:05:00Z',
  }),
  skill({
    name: 'code-review',
    description: 'Review a branch along two axes: standards and spec.',
    owner: ESkillOwner.Global,
    files: [
      textFile(
        'references/standards-checklist.md',
        '# Standards checklist\n\n- 300-line file cap\n- No `as any`\n- Named parameters\n',
      ),
    ],
    updatedAt: '2026-10-20T16:40:00Z',
  }),
  skill({
    name: 'research',
    description: 'Investigate a question against high-trust primary sources and capture findings.',
    owner: ESkillOwner.Global,
    files: [
      textFile(
        'scripts/fetch-source.ts',
        `export async function fetchSource(url: string): Promise<string> {\n  const response = await fetch(url)\n  return response.text()\n}\n`,
      ),
    ],
    updatedAt: '2026-10-15T08:30:00Z',
  }),
  skill({
    name: 'codebase-design',
    description: 'Shared vocabulary for designing deep modules and deciding where a seam goes.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-10-12T13:10:00Z',
  }),
  skill({
    name: 'dotenvx',
    description: 'Install, configure, and debug dotenvx encrypted environment files.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-10-08T10:00:00Z',
  }),
  skill({
    name: 'playwright-cli',
    description: 'Automate browser interactions, test web pages, and work with Playwright tests.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-10-05T09:45:00Z',
  }),
  skill({
    name: 'stop-slop',
    description: 'Remove AI writing patterns from prose.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-10-01T17:25:00Z',
  }),
  skill({
    name: 'ads',
    description: 'Paid advertising campaign strategy on Google, Meta, and LinkedIn.',
    owner: ESkillOwner.Global,
    files: [binaryFile('assets/channel-matrix.png', 241 * 1024)],
    updatedAt: '2026-08-19T12:00:00Z',
  }),
  skill({
    name: 'cold-email',
    description: 'B2B cold email and follow-up sequences that get replies.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-08-12T15:30:00Z',
  }),
  skill({
    name: 'seo-audit',
    description: 'Audit and diagnose technical and on-page SEO issues on a site.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-07-30T10:15:00Z',
  }),
  skill({
    name: 'aso',
    description: 'Audit an App Store or Google Play listing for visibility and conversion.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-07-22T09:00:00Z',
  }),
  skill({
    name: 'paywalls',
    description: 'Create and optimize in-app paywalls, upgrade screens, and feature gates.',
    owner: ESkillOwner.Global,
    updatedAt: '2026-07-02T13:50:00Z',
  }),
]

export const PROJECT_SKILLS: Skill[] = [
  skill({
    name: 'atlas',
    description: 'Handbook to the Atlas harness: settings, skills, MCP, worktrees, sandboxes.',
    owner: ESkillOwner.Project,
    files: [
      textFile(
        'references/services.md',
        '# services.yaml\n\nSchema and troubleshooting for declared services.\n',
      ),
      textFile(
        'references/worktrees.md',
        '# Worktrees\n\nHow Atlas creates, enters, and exits git worktrees.\n',
      ),
    ],
    updatedAt: '2026-11-01T18:10:00Z',
  }),
  skill({
    name: 'code-review',
    description: 'Atlas flavor: review against docs/architecture.md and core-contract seams.',
    owner: ESkillOwner.Project,
    updatedAt: '2026-10-26T09:20:00Z',
  }),
  skill({
    name: 'release-checklist',
    description: 'Steps to cut an Atlas release: version bump, changelog, sandbox image.',
    owner: ESkillOwner.Project,
    files: [
      textFile(
        'checklist.md',
        '# Release checklist\n\n1. Bump version\n2. Update CHANGELOG\n3. Tag and push\n',
      ),
      binaryFile('assets/release-flow.pdf', 188 * 1024),
    ],
    updatedAt: '2026-10-18T16:05:00Z',
  }),
  skill({
    name: 'incident-review',
    description: 'Post-incident review template and severity rubric for Atlas Cloud.',
    owner: ESkillOwner.Project,
    updatedAt: '2026-09-27T10:45:00Z',
  }),
]
