import type { ResolvedTarget } from '../../subscriptions/provider'
import { EForge, type RepositoryCheckout } from './pure'

export type PullRequestTarget = { repo: string; number: number }

const GITHUB_HOST = 'github.com'

const NUMBER_FORM = /^#?(\d+)$/
const SHORTHAND_FORM = /^([\w.-]+)\/([\w.-]+)#(\d+)$/
const URL_FORM = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/

export const NO_PULL_REQUEST_ERROR =
  "This thread's checkout has no pull request; pass #number, owner/repo#number or a URL"
export const NO_CHECKOUT_ERROR =
  'This thread has no checkout to take a repository from; pass owner/repo#number or a pull request URL'
export const NOT_GITHUB_ERROR =
  "This thread's checkout is not on github.com; pass owner/repo#number or a github.com pull request URL"
export const BAD_NUMBER_ERROR = 'A pull request number starts at 1'
export const UNRECOGNIZED_ERROR =
  'Not a pull request reference; pass nothing, #number, owner/repo#number or a github.com pull request URL'

export const labelOf = (target: PullRequestTarget): string =>
  `${target.repo.slice(GITHUB_HOST.length + 1).toLowerCase()}#${target.number}`

export const targetKey = (target: PullRequestTarget): string =>
  `${target.repo.toLowerCase()}#${target.number}`

export function targetOf(value: unknown): PullRequestTarget | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const { repo, number } = value as { repo?: unknown; number?: unknown }
  if (typeof repo !== 'string' || !repo.toLowerCase().startsWith(`${GITHUB_HOST}/`)) return null
  if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) return null

  return { repo: repo.toLowerCase(), number }
}

const resolved = (target: PullRequestTarget): ResolvedTarget => {
  const lowered = { repo: target.repo.toLowerCase(), number: target.number }
  return { target: lowered, label: labelOf(lowered) }
}

const onGitHubDotCom = (checkout: RepositoryCheckout): boolean =>
  checkout.forge === EForge.GitHub && checkout.remote.host === GITHUB_HOST

const checkoutRepo = (checkout: RepositoryCheckout): string =>
  `${GITHUB_HOST}/${checkout.remote.owner}/${checkout.remote.repo}`

const explicit = (args: {
  owner: string
  repo: string
  number: string
}): ResolvedTarget | { error: string } => {
  const number = Number(args.number)
  if (number < 1) return { error: BAD_NUMBER_ERROR }

  return resolved({ repo: `${GITHUB_HOST}/${args.owner}/${args.repo}`, number })
}

export function resolveSubscriptionTarget(args: {
  input: string
  checkout: RepositoryCheckout | null
  foundNumber: number | null
}): ResolvedTarget | { error: string } {
  const input = args.input.trim()
  const { checkout } = args

  if (input.length === 0) {
    if (checkout === null || args.foundNumber === null) return { error: NO_PULL_REQUEST_ERROR }
    if (!onGitHubDotCom(checkout)) return { error: NOT_GITHUB_ERROR }

    return resolved({ repo: checkoutRepo(checkout), number: args.foundNumber })
  }

  const bare = NUMBER_FORM.exec(input)
  if (bare?.[1] !== undefined) {
    const number = Number(bare[1])
    if (number < 1) return { error: BAD_NUMBER_ERROR }
    if (checkout === null) return { error: NO_CHECKOUT_ERROR }
    if (!onGitHubDotCom(checkout)) return { error: NOT_GITHUB_ERROR }

    return resolved({ repo: checkoutRepo(checkout), number })
  }

  const matched = SHORTHAND_FORM.exec(input) ?? URL_FORM.exec(input)
  const [, owner, repo, number] = matched ?? []
  if (owner === undefined || repo === undefined || number === undefined) {
    return { error: UNRECOGNIZED_ERROR }
  }

  return explicit({ owner, repo, number })
}
