import type { RecordEvent } from '@dltech/atlas-core'

const LEFT_WORKTREE: ReadonlySet<string> = new Set([
  'worktree-exited',
  'directory-changed',
  'location-changed',
])

export const enteredWorktreePathOf = (args: {
  events: readonly RecordEvent[]
  threadId: string
}): string | undefined => {
  for (let index = args.events.length - 1; index >= 0; index -= 1) {
    const event = args.events[index]
    if (event === undefined || event.threadId !== args.threadId) continue
    if (event.type === 'worktree-entered') return event.path
    if (LEFT_WORKTREE.has(event.type)) return undefined
  }
  return undefined
}
