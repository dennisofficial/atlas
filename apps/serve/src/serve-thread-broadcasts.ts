import { EServeFrame, type ServeFrame } from '@dltech/atlas-harness'

import type { ServeApp } from './serve-app'

export function subscribeThreadBroadcasts(args: {
  threads: ServeApp['threads']
  broadcast: (frame: ServeFrame) => void
}): (() => void) | undefined {
  const onRename = args.threads.onRename?.bind(args.threads)
  const onModelChosen = args.threads.onModelChosen?.bind(args.threads)
  if (onRename === undefined || onModelChosen === undefined) return undefined
  const offs = [
    onRename(({ threadId, title }) =>
      args.broadcast({ kind: EServeFrame.ThreadRenamed, threadId, title }),
    ),
    onModelChosen(({ threadId, model }) =>
      args.broadcast({ kind: EServeFrame.ThreadModelChanged, threadId, model }),
    ),
  ]
  return () => {
    for (const off of offs) off()
  }
}
