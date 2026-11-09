import type { StreamSessionRow } from '@dltech/atlas-protocol'

import type { FollowedSessionList } from './sessions-list'

export type SessionsFeed = { retain(): () => void }

export const createSessionsFeed = (args: {
  follow: () => FollowedSessionList
  write: (rows: readonly StreamSessionRow[]) => void
}): SessionsFeed => {
  let holders = 0
  let stop: (() => void) | undefined

  const open = (): (() => void) => {
    const list = args.follow()
    const handleChange = (): void => {
      const rows = list.getSnapshot()
      if (rows !== undefined) args.write(rows)
    }
    const unsubscribe = list.subscribe(handleChange)
    handleChange()
    return () => {
      unsubscribe()
      list.close()
    }
  }

  return {
    retain: () => {
      holders += 1
      if (holders === 1) stop = open()
      let released = false
      return () => {
        if (released) return
        released = true
        holders -= 1
        if (holders > 0) return
        stop?.()
        stop = undefined
      }
    },
  }
}
