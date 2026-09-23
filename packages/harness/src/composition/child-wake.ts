import type { ThreadId } from '@dltech/atlas-core'

export type WakeSource = {
  threadsAwaitingNotice(): readonly ThreadId[]
  onNotice(listener: () => void): () => void
}

export type WakeTarget = {
  wake(args: { agentId: ThreadId }): Promise<unknown>
}

export class ChildWake {
  private readonly unbind: ReadonlyArray<() => void>

  constructor(args: { sources: readonly WakeSource[]; agents: WakeTarget }) {
    this.unbind = args.sources.map((source) =>
      source.onNotice(() => {
        for (const threadId of source.threadsAwaitingNotice()) {
          void args.agents.wake({ agentId: threadId })
        }
      }),
    )
  }

  dispose(): void {
    for (const off of this.unbind) off()
  }
}
