import type { ThreadId } from '@dltech/atlas-core'

export class ChildAdmissions {
  private readonly pending = new Map<ThreadId, Set<Promise<unknown>>>()
  private readonly onSettled: () => void

  constructor(args: { onSettled: () => void }) {
    this.onSettled = args.onSettled
  }

  admit<T>(args: { threadId: ThreadId; start: () => Promise<T> }): Promise<T> {
    const admitted = Promise.resolve().then(args.start)
    const owned = this.pending.get(args.threadId) ?? new Set<Promise<unknown>>()
    this.pending.set(args.threadId, owned)
    owned.add(admitted)
    const finish = (): void => {
      owned.delete(admitted)
      if (owned.size === 0) this.pending.delete(args.threadId)
      if (!this.settling()) this.onSettled()
    }
    void admitted.then(finish, finish)
    return admitted
  }

  settling(args?: { threadIds: readonly ThreadId[] }): boolean {
    if (args === undefined) return this.pending.size > 0
    return args.threadIds.some((threadId) => (this.pending.get(threadId)?.size ?? 0) > 0)
  }

  async whenSettled(args: { threadIds: readonly ThreadId[] }): Promise<void> {
    while (this.settling(args)) {
      const pending = args.threadIds.flatMap((threadId) => [...(this.pending.get(threadId) ?? [])])
      const results = await Promise.allSettled(pending)
      const rejected = results.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
    }
  }
}
