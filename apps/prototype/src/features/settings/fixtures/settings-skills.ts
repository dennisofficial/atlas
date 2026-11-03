export enum ESkillLayer {
  Repo = 'repo',
  Project = 'project',
  Global = 'global',
  BuiltIn = 'builtin',
}

export const SKILL_LAYER_LABELS: Record<ESkillLayer, string> = {
  [ESkillLayer.Repo]: 'Repo',
  [ESkillLayer.Project]: 'Project',
  [ESkillLayer.Global]: 'Global',
  [ESkillLayer.BuiltIn]: 'Built-in',
}

export const EDITABLE_LAYERS: readonly ESkillLayer[] = [ESkillLayer.Global, ESkillLayer.Project]

export function isEditableLayer(layer: ESkillLayer): boolean {
  return EDITABLE_LAYERS.includes(layer)
}

export type SkillFile = {
  path: string
  content: string
}

export type Skill = {
  name: string
  description: string
  layer: ESkillLayer
  files: SkillFile[]
  updatedAt: string
}

const SKILL_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
})

export function formatSkillDate(updatedAt: string): string {
  return SKILL_DATE_FORMAT.format(new Date(updatedAt))
}

export function formatSkillSize(files: SkillFile[]): string {
  const bytes = files.reduce((total, file) => total + new Blob([file.content]).size, 0)
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export function skillIdOf({ name, layer }: Pick<Skill, 'name' | 'layer'>): string {
  return `${layer}:${name}`
}

export function parseSkillId(id: string): Pick<Skill, 'name' | 'layer'> | null {
  const sep = id.indexOf(':')
  if (sep <= 0) return null
  const layer = id.slice(0, sep) as ESkillLayer
  if (!Object.values(ESkillLayer).includes(layer)) return null
  return { layer, name: id.slice(sep + 1) }
}

export type SkillRow = {
  skill: Skill
  shadowedBy: ESkillLayer | null
  overrides: ESkillLayer[]
}

export function buildSkillRows(skills: Skill[]): SkillRow[] {
  const precedence = [
    ESkillLayer.Repo,
    ESkillLayer.Project,
    ESkillLayer.Global,
    ESkillLayer.BuiltIn,
  ]
  return skills.map((skill) => {
    const closer = precedence.indexOf(skill.layer)
    const others = skills.filter(
      (candidate) => candidate.name === skill.name && candidate !== skill,
    )
    const shadowedBy =
      others.find((candidate) => precedence.indexOf(candidate.layer) < closer)?.layer ?? null
    const overrides = others
      .filter((candidate) => precedence.indexOf(candidate.layer) > closer)
      .map((candidate) => candidate.layer)
      .sort((a, b) => precedence.indexOf(a) - precedence.indexOf(b))
    return { skill, shadowedBy, overrides }
  })
}

function skillMd({ name, description, body }: { name: string; description: string; body: string }) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`
}

function skill({
  name,
  description,
  layer,
  files = [],
  updatedAt,
}: {
  name: string
  description: string
  layer: ESkillLayer
  files?: SkillFile[]
  updatedAt: string
}): Skill {
  return {
    name,
    description,
    layer,
    updatedAt,
    files: [
      {
        path: 'SKILL.md',
        content: skillMd({
          name,
          description,
          body: `When to use this skill, and how it behaves, go here.`,
        }),
      },
      ...files,
    ],
  }
}

export const SKILLS: Skill[] = [
  skill({
    name: 'ui-design',
    description: 'Default guidance for every UI task: layout, spacing, hierarchy, typography.',
    layer: ESkillLayer.Global,
    files: [
      {
        path: 'references/type-scale.md',
        content: '# Type scale\n\nPick a practical scale and constrain it deliberately.\n',
      },
      {
        path: 'references/empty-states.md',
        content: '# Empty states\n\nTeach and guide instead of showing a blank screen.\n',
      },
    ],
    updatedAt: '2026-11-02T09:00:00Z',
  }),
  skill({
    name: 'code-comments',
    description: 'Write code that reads like English; comments only for what code cannot say.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-10-28T14:20:00Z',
  }),
  skill({
    name: 'tdd',
    description: 'Test-driven development: red-green-refactor for features and bug fixes.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-10-24T11:05:00Z',
  }),
  skill({
    name: 'code-review',
    description: 'Review a branch along two axes: standards and spec.',
    layer: ESkillLayer.Global,
    files: [
      {
        path: 'references/standards-checklist.md',
        content:
          '# Standards checklist\n\n- 300-line file cap\n- No `as any`\n- Named parameters\n',
      },
    ],
    updatedAt: '2026-10-20T16:40:00Z',
  }),
  skill({
    name: 'research',
    description: 'Investigate a question against high-trust primary sources and capture findings.',
    layer: ESkillLayer.Global,
    files: [
      {
        path: 'scripts/fetch-source.ts',
        content: `export async function fetchSource(url: string): Promise<string> {\n  const response = await fetch(url)\n  return response.text()\n}\n`,
      },
    ],
    updatedAt: '2026-10-15T08:30:00Z',
  }),
  skill({
    name: 'codebase-design',
    description: 'Shared vocabulary for designing deep modules and deciding where a seam goes.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-10-12T13:10:00Z',
  }),
  skill({
    name: 'dotenvx',
    description: 'Install, configure, and debug dotenvx encrypted environment files.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-10-08T10:00:00Z',
  }),
  skill({
    name: 'playwright-cli',
    description: 'Automate browser interactions, test web pages, and work with Playwright tests.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-10-05T09:45:00Z',
  }),
  skill({
    name: 'stop-slop',
    description: 'Remove AI writing patterns from prose.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-10-01T17:25:00Z',
  }),
  skill({
    name: 'ads',
    description: 'Paid advertising campaign strategy on Google, Meta, and LinkedIn.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-08-19T12:00:00Z',
  }),
  skill({
    name: 'cold-email',
    description: 'B2B cold email and follow-up sequences that get replies.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-08-12T15:30:00Z',
  }),
  skill({
    name: 'seo-audit',
    description: 'Audit and diagnose technical and on-page SEO issues on a site.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-07-30T10:15:00Z',
  }),
  skill({
    name: 'aso',
    description: 'Audit an App Store or Google Play listing for visibility and conversion.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-07-22T09:00:00Z',
  }),
  skill({
    name: 'paywalls',
    description: 'Create and optimize in-app paywalls, upgrade screens, and feature gates.',
    layer: ESkillLayer.Global,
    updatedAt: '2026-07-02T13:50:00Z',
  }),
  skill({
    name: 'atlas',
    description: 'Handbook to the Atlas harness: settings, skills, MCP, worktrees, sandboxes.',
    layer: ESkillLayer.Project,
    files: [
      {
        path: 'references/services.md',
        content: '# services.yaml\n\nSchema and troubleshooting for declared services.\n',
      },
      {
        path: 'references/worktrees.md',
        content: '# Worktrees\n\nHow Atlas creates, enters, and exits git worktrees.\n',
      },
    ],
    updatedAt: '2026-11-01T18:10:00Z',
  }),
  skill({
    name: 'code-review',
    description: 'Atlas flavor: review against docs/architecture.md and core-contract seams.',
    layer: ESkillLayer.Project,
    updatedAt: '2026-10-26T09:20:00Z',
  }),
  skill({
    name: 'tdd',
    description: 'Atlas repo rules: bun test everywhere, incremental specs, live-Docker gating.',
    layer: ESkillLayer.Repo,
    files: [
      {
        path: 'references/incremental.md',
        content:
          '# Incremental tests\n\n`bun test --changed=<base>` pre-filters specs by git diff.\n',
      },
    ],
    updatedAt: '2026-10-30T08:00:00Z',
  }),
  skill({
    name: 'opentui-perf',
    description: 'Repo-specific OpenTUI repaint cost rules and the shared ticker pattern.',
    layer: ESkillLayer.Repo,
    updatedAt: '2026-10-27T12:35:00Z',
  }),
  skill({
    name: 'commit',
    description: 'Stage the current work and write a conventional commit message for it.',
    layer: ESkillLayer.BuiltIn,
    updatedAt: '2026-09-10T00:00:00Z',
  }),
  skill({
    name: 'handoff',
    description: 'Compact the conversation into a handoff document for another agent.',
    layer: ESkillLayer.BuiltIn,
    updatedAt: '2026-09-10T00:00:00Z',
  }),
  skill({
    name: 'code-review',
    description: 'Base review flow shipped with Atlas: diffs, comments, and summaries.',
    layer: ESkillLayer.BuiltIn,
    updatedAt: '2026-09-10T00:00:00Z',
  }),
]

export const SKILLS_PROJECT = 'dennisofficial/atlas'

export const SKILLS_PROJECTS = ['dennisofficial/atlas', 'trycompai/comp', 'dennisofficial/rs-crm']

export const REPO_SOURCE_URL = 'https://github.com/dennisofficial/atlas/tree/main/.atlas/skills'
