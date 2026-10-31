import type { ThreadEventsLiveFrame } from '@dltech/atlas-wire/web'

import type { ThreadStreamHandlers } from './thread-signals'

export function trackedThreadStreamHandlers(args: {
  handlers: ThreadStreamHandlers
  onCursor?: ((cursor: string) => void) | undefined
}) {
  return {
    ...args.handlers,
    onData: ({ id, data }: ThreadEventsLiveFrame) => {
      args.handlers.onData(data)
      args.onCursor?.(id)
    },
  }
}
