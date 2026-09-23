import { ECloudSandboxState } from '@dltech/atlas-harness'

import { theme } from './theme'

export type ThreadBadge = { text: string; fg: string }

/**
 * The picker's one-glance answer for a cloud thread, in the footer's own vocabulary: a cloud that
 * answers, a moon that is parked, a cloud that is coming back. Before the batch read lands the
 * location alone is known, so the badge says cloud and nothing more.
 */
export function cloudSandboxBadge(args: {
  state: ECloudSandboxState | undefined
}): ThreadBadge {
  if (args.state === ECloudSandboxState.Running) return { text: '☁ running', fg: theme.ok }
  if (args.state === ECloudSandboxState.Parked) return { text: '☾ parked', fg: theme.hint }
  if (args.state === ECloudSandboxState.Resuming) return { text: '☁ resuming', fg: theme.warn }
  return { text: '☁ cloud', fg: theme.hint }
}
