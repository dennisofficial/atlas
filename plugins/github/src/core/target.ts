export const GITHUB_PROVIDER = 'github.pull-request'

export type PullRequestTarget = { repo: string; number: number }

const GITHUB_HOST = 'github.com'
const NUMBER_FORM = /^#?(\d+)$/
const SHORTHAND_FORM = /^([\w.-]+)\/([\w.-]+)#(\d+)$/
const URL_FORM = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/
const NAME_WITH_OWNER = /^[\w.-]+\/[\w.-]+$/

export const BAD_NUMBER_ERROR = 'A pull request number starts at 1'
export const NO_PULL_REQUEST_ERROR =
  'This checkout has no pull request; pass #number, owner/repo#number or a URL'
export const NO_REPOSITORY_ERROR =
  'No GitHub repository to take a number from; pass owner/repo#number or a pull request URL'
export const UNRECOGNIZED_ERROR =
  'Not a pull request reference; pass nothing, #number, owner/repo#number or a github.com pull request URL'

export type TargetInput =
  | { kind: 'explicit'; target: PullRequestTarget }
  | { kind: 'number'; number: number }
  | { kind: 'current' }
  | { kind: 'error'; error: string }

const explicit = (args: { owner: string; repo: string; number: string }): TargetInput => {
  const number = Number(args.number)
  if (number < 1) return { kind: 'error', error: BAD_NUMBER_ERROR }
  return {
    kind: 'explicit',
    target: { repo: `${GITHUB_HOST}/${args.owner}/${args.repo}`.toLowerCase(), number },
  }
}

export const parseTargetInput = (raw: string): TargetInput => {
  const input = raw.trim()
  if (input.length === 0) return { kind: 'current' }
  const bare = NUMBER_FORM.exec(input)
  if (bare?.[1] !== undefined) {
    const number = Number(bare[1])
    return number < 1 ? { kind: 'error', error: BAD_NUMBER_ERROR } : { kind: 'number', number }
  }
  const [, owner, repo, number] = SHORTHAND_FORM.exec(input) ?? URL_FORM.exec(input) ?? []
  if (owner === undefined || repo === undefined || number === undefined) {
    return { kind: 'error', error: UNRECOGNIZED_ERROR }
  }
  return explicit({ owner, repo, number })
}

export const targetOfRepo = (args: {
  nameWithOwner: string
  number: number
}): PullRequestTarget | undefined => {
  const name = args.nameWithOwner.trim()
  if (!NAME_WITH_OWNER.test(name) || args.number < 1) return undefined
  return { repo: `${GITHUB_HOST}/${name}`.toLowerCase(), number: args.number }
}

export const labelOf = (target: PullRequestTarget): string =>
  `${target.repo.slice(GITHUB_HOST.length + 1)}#${target.number}`

export const targetOf = (value: unknown): PullRequestTarget | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const { repo, number } = value as { repo?: unknown; number?: unknown }
  if (typeof repo !== 'string' || !repo.toLowerCase().startsWith(`${GITHUB_HOST}/`)) return null
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null
  return { repo: repo.toLowerCase(), number }
}

export const sameTarget = (a: PullRequestTarget, b: PullRequestTarget): boolean =>
  a.repo === b.repo && a.number === b.number
