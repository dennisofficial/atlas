import { EPrEventKind, inboxEventPayloadOf } from '@dltech/atlas-core'

import { notifyPrSubscribers } from './github-pr-subscriber-notice'

export const autoMergeOffEventOf = (args: {
  repoFullName: string
  prNumber: number
  reason?: string | null | undefined
}): string => {
  const reason = args.reason?.trim() ?? ''
  return inboxEventPayloadOf({
    event: {
      type: 'pr-event',
      repo: `github.com/${args.repoFullName}`,
      prNumber: args.prNumber,
      kind: EPrEventKind.AutoMergeOff,
      url: `https://github.com/${args.repoFullName}/pull/${args.prNumber}`,
      ...(reason === '' ? {} : { reason }),
    },
  })
}

export async function notifyAutoMergeOff(args: {
  repoFullName: string
  prNumber: number
  reason?: string | null | undefined
}): Promise<number> {
  return await notifyPrSubscribers({
    repoFullName: args.repoFullName,
    prNumber: args.prNumber,
    payload: autoMergeOffEventOf(args),
    what: 'turned auto-merge off',
  })
}
