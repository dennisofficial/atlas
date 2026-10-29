import {
  ESecretsScope,
  PERSONAL_SECRETS,
  type LibrarySecret,
} from '../../settings/fixtures/settings-library'

export enum EShipBehavior {
  OpenPullRequest = 'open-pr',
  Push = 'push',
  Merge = 'merge',
}

export interface GithubRepo {
  owner: string
  name: string
  description: string
  isPrivate: boolean
  defaultBranch: string
  avatarUrl: string | null
}

export interface ProjectFixture extends GithubRepo {
  baseBranch: string | null
  shipBehavior: EShipBehavior
  additionalRepositories: readonly string[]
}

function fixtureAvatar({ from, to }: { from: string; to: string }): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
    '<rect width="64" height="64" fill="url(#g)"/>',
    '<circle cx="32" cy="32" r="14" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="5"/>',
    '</svg>',
  ].join('')
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const DENNIS_AVATAR = fixtureAvatar({ from: '#c2410c', to: '#7c2d12' })
const DLTECH_AVATAR = fixtureAvatar({ from: '#0e7490', to: '#164e63' })

const ATLAS_REPO: GithubRepo = {
  owner: 'dennisofficial',
  name: 'atlas',
  description: 'Coding-agent harness: the loop, the TUI, and Atlas Cloud.',
  isPrivate: false,
  defaultBranch: 'main',
  avatarUrl: DENNIS_AVATAR,
}

export const GITHUB_REPOS: readonly GithubRepo[] = [
  ATLAS_REPO,
  {
    owner: 'dennisofficial',
    name: 'atlas-docs',
    description: 'Documentation site for Atlas.',
    isPrivate: false,
    defaultBranch: 'main',
    avatarUrl: DENNIS_AVATAR,
  },
  {
    owner: 'dennisofficial',
    name: 'atlas-sandbox-image',
    description: 'The container image Atlas sandboxes boot from.',
    isPrivate: false,
    defaultBranch: 'main',
    avatarUrl: DENNIS_AVATAR,
  },
  {
    owner: 'dennisofficial',
    name: 'comp-v3',
    description: 'Compliance automation platform.',
    isPrivate: true,
    defaultBranch: 'main',
    avatarUrl: DENNIS_AVATAR,
  },
  {
    owner: 'dennisofficial',
    name: 'dotfiles',
    description: 'Shell, editor and git configuration.',
    isPrivate: true,
    defaultBranch: 'master',
    avatarUrl: DENNIS_AVATAR,
  },
  {
    owner: 'dltech',
    name: 'billing-service',
    description: 'Usage metering and invoicing.',
    isPrivate: true,
    defaultBranch: 'main',
    avatarUrl: DLTECH_AVATAR,
  },
  {
    owner: 'dltech',
    name: 'design-tokens',
    description: 'Shared color and type tokens.',
    isPrivate: false,
    defaultBranch: 'main',
    avatarUrl: DLTECH_AVATAR,
  },
  {
    owner: 'oven-sh',
    name: 'bun',
    description: 'Incredibly fast JavaScript runtime, bundler, test runner, and package manager.',
    isPrivate: false,
    defaultBranch: 'main',
    avatarUrl: null,
  },
  {
    owner: 'vercel',
    name: 'ai',
    description: 'The AI Toolkit for TypeScript.',
    isPrivate: false,
    defaultBranch: 'main',
    avatarUrl: null,
  },
]

export const PROJECT_BRANCHES: readonly string[] = [
  'main',
  'dennis/sandbox-settings',
  'dennis/model-catalogue',
  'dennis/mcp-oauth',
  'feat/atlas-cloud-threads',
  'fix/serve-reconnect',
  'refactor/harness-ports',
  'release/0.9',
  'release/0.8',
  'staging',
]

export const PROJECT: ProjectFixture = {
  ...ATLAS_REPO,
  baseBranch: null,
  shipBehavior: EShipBehavior.OpenPullRequest,
  additionalRepositories: ['dennisofficial/atlas-docs'],
}

const RS_CRM: ProjectFixture = {
  owner: 'dennisofficial',
  name: 'rs-crm',
  description: 'Customer relationship manager for a real-estate studio.',
  isPrivate: true,
  defaultBranch: 'main',
  avatarUrl: DENNIS_AVATAR,
  baseBranch: null,
  shipBehavior: EShipBehavior.OpenPullRequest,
  additionalRepositories: ['dennisofficial/atlas-docs'],
}

export const PROJECTS_BY_ID: Readonly<Record<string, ProjectFixture>> = {
  atlas: PROJECT,
  'rs-crm': RS_CRM,
}

export function projectById(projectId: string): ProjectFixture | null {
  return Object.hasOwn(PROJECTS_BY_ID, projectId) ? (PROJECTS_BY_ID[projectId] ?? null) : null
}

export const SHIP_BEHAVIORS: readonly {
  value: EShipBehavior
  label: string
  description: string
}[] = [
  {
    value: EShipBehavior.OpenPullRequest,
    label: 'Open pull request',
    description: 'Push the branch and open a PR for review.',
  },
  {
    value: EShipBehavior.Push,
    label: 'Push branch',
    description: 'Push the branch. You open the PR.',
  },
  {
    value: EShipBehavior.Merge,
    label: 'Merge',
    description: 'Merge into the base branch when checks pass.',
  },
]

export interface SandboxSize {
  vcpus: number
  memoryGb: number
}

export const SANDBOX_SIZES: readonly SandboxSize[] = [
  { vcpus: 2, memoryGb: 4 },
  { vcpus: 4, memoryGb: 8 },
  { vcpus: 6, memoryGb: 12 },
  { vcpus: 8, memoryGb: 16 },
]

export const DEFAULT_SANDBOX_VCPUS = 4

export const SETUP_SCRIPT = `bun install --frozen-lockfile
bun run --filter @dltech/atlas-ui generate
bunx turbo run typecheck --filter @dltech/atlas-core`

export const PROJECT_SECRETS: LibrarySecret[] = [
  {
    id: 'j1',
    key: 'ANTHROPIC_API_KEY',
    value: 'sk-ant-api03-q8Zr2mVd7Lk0aPp4xT9e',
    updated: '2h ago',
    scope: ESecretsScope.Project,
  },
  {
    id: 'j2',
    key: 'DATABASE_URL',
    value: 'postgres://atlas:hunter2@ep-calm-sun.neon.tech/atlas',
    updated: '3d ago',
    scope: ESecretsScope.Project,
  },
  {
    id: 'j3',
    key: 'NEXT_PUBLIC_APP_URL',
    value: 'http://localhost:3000',
    updated: '1w ago',
    scope: ESecretsScope.Project,
  },
]

export const PROJECT_SECRET_ROWS: LibrarySecret[] = [...PROJECT_SECRETS, ...PERSONAL_SECRETS]
