import { GITHUB_REPO_PATTERN, type GithubRepoSummary } from '@dltech/atlas-wire/web'

export enum ERepoInputKind {
  Empty = 'Empty',
  Valid = 'Valid',
  Invalid = 'Invalid',
}

export type RepoInput =
  | { kind: ERepoInputKind.Empty }
  | { kind: ERepoInputKind.Valid; repo: string }
  | { kind: ERepoInputKind.Invalid }

const GITHUB_PREFIX = /^(?:(?:https?:\/\/)?(?:www\.)?github\.com\/|git@github\.com:)/i
const FOREIGN_HOST = /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|[^/]*\.[a-z]{2,}\/)/i

export const BAD_REPO_INPUT_MESSAGE =
  'That is not a GitHub repository. Paste a github.com URL or owner/name.'

export function parseRepoInput(raw: string): RepoInput {
  const trimmed = raw.trim()
  if (!trimmed) return { kind: ERepoInputKind.Empty }
  const prefix = GITHUB_PREFIX.exec(trimmed)
  if (!prefix && FOREIGN_HOST.test(trimmed)) return { kind: ERepoInputKind.Invalid }
  const parts = trimmed.slice(prefix ? prefix[0].length : 0).split('/')
  if (!prefix && parts.length !== 2) return { kind: ERepoInputKind.Invalid }
  const [owner, name] = parts
  if (!owner || !name) return { kind: ERepoInputKind.Invalid }
  const candidate = `${owner}/${name.replace(/\.git$/i, '')}`
  if (!GITHUB_REPO_PATTERN.test(candidate)) return { kind: ERepoInputKind.Invalid }
  return { kind: ERepoInputKind.Valid, repo: candidate }
}

export const findGithubRepo = ({
  repos,
  fullName,
}: {
  repos: readonly GithubRepoSummary[]
  fullName: string
}): GithubRepoSummary | undefined =>
  repos.find((repo) => repo.fullName.toLowerCase() === fullName.toLowerCase())

export function repoChoices({
  repos,
  query,
}: {
  repos: readonly GithubRepoSummary[]
  query: string
}): string[] {
  const parsed = parseRepoInput(query)
  const needle = (parsed.kind === ERepoInputKind.Valid ? parsed.repo : query).trim().toLowerCase()
  const known = repos
    .map((repo) => repo.fullName)
    .filter((name) => name.toLowerCase().includes(needle))
  if (parsed.kind !== ERepoInputKind.Valid) return known
  if (findGithubRepo({ repos, fullName: parsed.repo })) return known
  return [...known, parsed.repo]
}

export function repoInputError({
  query,
  choices,
}: {
  query: string
  choices: readonly string[]
}): string | null {
  if (choices.length > 0) return null
  return parseRepoInput(query).kind === ERepoInputKind.Invalid ? BAD_REPO_INPUT_MESSAGE : null
}

export const defaultBranchOf = ({
  repos,
  repo,
}: {
  repos: readonly GithubRepoSummary[]
  repo: string
}): string | null => findGithubRepo({ repos, fullName: repo })?.defaultBranch ?? null

export const branchChoices = ({
  branches,
  defaultBranch,
}: {
  branches: readonly string[]
  defaultBranch: string | null
}): string[] => branches.filter((branch) => branch !== defaultBranch)
