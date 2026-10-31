import type { GithubRepoSummary } from './new-project-types'

const HOUR_MS = 3_600_000

const ago = (hours: number): string => new Date(Date.now() - hours * HOUR_MS).toISOString()

export const NEW_PROJECT_REPOS: readonly GithubRepoSummary[] = [
  { fullName: 'dennisofficial/atlas', defaultBranch: 'main', isPrivate: false, pushedAt: ago(2) },
  {
    fullName: 'dennisofficial/atlas-docs',
    defaultBranch: 'main',
    isPrivate: false,
    pushedAt: ago(30),
  },
  { fullName: 'dennisofficial/rs-crm', defaultBranch: 'main', isPrivate: true, pushedAt: ago(52) },
  {
    fullName: 'dennisofficial/dotfiles',
    defaultBranch: 'master',
    isPrivate: true,
    pushedAt: ago(200),
  },
  {
    fullName: 'dennisofficial/ledger-cli',
    defaultBranch: 'main',
    isPrivate: false,
    pushedAt: ago(400),
  },
  {
    fullName: 'dennisofficial/recipe-box',
    defaultBranch: 'main',
    isPrivate: true,
    pushedAt: ago(700),
  },
  { fullName: 'dltech/atlas-ui-kit', defaultBranch: 'main', isPrivate: true, pushedAt: ago(90) },
  { fullName: 'dltech/infra', defaultBranch: 'main', isPrivate: true, pushedAt: ago(160) },
  {
    fullName: 'dltech/marketing-site',
    defaultBranch: 'develop',
    isPrivate: false,
    pushedAt: ago(300),
  },
  {
    fullName: 'dltech/billing-service',
    defaultBranch: 'main',
    isPrivate: true,
    pushedAt: ago(520),
  },
  {
    fullName: 'dltech/design-tokens',
    defaultBranch: 'main',
    isPrivate: false,
    pushedAt: ago(1100),
  },
  { fullName: 'dltech/empty-template', defaultBranch: 'main', isPrivate: false, pushedAt: null },
]

export const NEW_PROJECT_BRANCHES: readonly string[] = [
  'main',
  'develop',
  'dennis/new-project-options',
  'feat/atlas-cloud-threads',
  'fix/serve-reconnect',
  'release/0.12',
]

export const SANDBOX_SIZES = [
  { id: 'default', vcpus: null, label: 'Account default' },
  ...[2, 4, 6, 8].map((vcpus) => ({
    id: `${vcpus}-vcpu`,
    vcpus,
    label: `${vcpus} vCPU · ${vcpus * 2} GB RAM`,
  })),
] as const

export const sizeIdOf = (vcpus: number | null): string =>
  vcpus === null ? 'default' : `${vcpus}-vcpu`

export const vcpusOfSizeId = (id: string): number | null =>
  SANDBOX_SIZES.find((size) => size.id === id)?.vcpus ?? null
