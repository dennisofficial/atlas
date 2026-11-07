import { normalizedPrRepo } from '../../github/pr-repo'
import type { V2Event } from '../event'

export type PullRequestLink = { repo: string; number: number; url: string; branch: string }

export type PullRequestLinksState = { links: readonly PullRequestLink[] }

export const initialPullRequestLinks: PullRequestLinksState = { links: [] }

export const stepPullRequestLinks = (
  state: PullRequestLinksState,
  event: V2Event,
): PullRequestLinksState => {
  if (event.type !== 'pull-request-linked') return state
  const link: PullRequestLink = {
    repo: normalizedPrRepo(event.repo),
    number: event.number,
    url: event.url,
    branch: event.branch,
  }
  const index = state.links.findIndex(
    (kept) => kept.repo === link.repo && kept.number === link.number,
  )
  if (index < 0) return { links: [...state.links, link] }
  return { links: state.links.map((kept, at) => (at === index ? link : kept)) }
}
