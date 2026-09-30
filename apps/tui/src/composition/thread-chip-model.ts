import { EPullRequestLookup, pullRequestBadge, type PullRequestReading, type RepositoryCheckout } from '@dltech/atlas-harness'

import { pullRequestChip } from '../plugins/github/pull-request-pill'
import { theme } from '../ui/theme'
import type { ThreadChip } from '../ui/threads-model'

export type CheckoutProbe = (args: { directory: string }) => Promise<RepositoryCheckout | null>

export const MUTED_CHIP: Pick<ThreadChip, 'ground' | 'ink'> = {
  ground: theme.selectedBg,
  ink: theme.body,
}

export const chipFromReading = (args: {
  label: string
  reading: PullRequestReading
}): ThreadChip => {
  if (args.reading.lookup !== EPullRequestLookup.Found) {
    return { label: args.label, ...MUTED_CHIP }
  }

  const drawn = pullRequestChip(pullRequestBadge(args.reading.pullRequest))
  return { label: args.label, ground: drawn.ground, ink: drawn.spans[0]?.fg ?? theme.body }
}

export const sameChips = (left: readonly ThreadChip[], right: readonly ThreadChip[]): boolean =>
  left.length === right.length &&
  left.every(
    (chip, index) =>
      chip.label === right[index]?.label &&
      chip.ground === right[index]?.ground &&
      chip.ink === right[index]?.ink,
  )
