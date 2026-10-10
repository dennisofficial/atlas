import type { LinkedPullRequest } from '@dltech/atlas-core'

import {
  checkoutKey,
  EPullRequestLookup,
  type PullRequestPort,
  type PullRequestReading,
  type RepositoryCheckout,
} from './pure'

export type PullTarget =
  | { kind: 'checkout'; checkout: RepositoryCheckout }
  | { kind: 'link'; link: LinkedPullRequest }

const CANNOT_ASK: PullRequestReading = {
  lookup: EPullRequestLookup.Unavailable,
  retryable: true,
}

export const linkKey = (link: { repo: string; number: number }): string =>
  `${link.repo}#${link.number}`

export const keyOf = (target: PullTarget): string =>
  target.kind === 'checkout' ? checkoutKey(target.checkout) : linkKey(target.link)

/**
 * A port is allowed to reject — a pushing one loses its socket by throwing — and a rejection that
 * escaped would leave the failure uncounted, so the backoff would never start and the tick would
 * ask again every floor.
 */
export async function readTarget(args: {
  port: PullRequestPort
  target: PullTarget
}): Promise<PullRequestReading> {
  const { port, target } = args
  try {
    return target.kind === 'checkout'
      ? await port.read({ checkout: target.checkout })
      : await port.readLinked({ repo: target.link.repo, number: target.link.number })
  } catch {
    return CANNOT_ASK
  }
}
