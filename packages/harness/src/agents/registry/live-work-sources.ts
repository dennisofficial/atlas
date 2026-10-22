import type { ThreadId } from '@dltech/atlas-core'

export type LiveWorkSource = (threadId: ThreadId) => string | undefined

export class LiveWorkSources {
  private readonly sources = new Set<LiveWorkSource>()

  register(source: LiveWorkSource): () => void {
    this.sources.add(source)
    return () => void this.sources.delete(source)
  }

  reasonFor({ threadId }: { threadId: ThreadId }): string | undefined {
    for (const source of this.sources) {
      const reason = source(threadId)
      if (reason !== undefined) return reason
    }
    return undefined
  }
}
