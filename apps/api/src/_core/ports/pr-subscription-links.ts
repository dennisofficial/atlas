export type PrSubscriptionLinkEventRow = { type: string; body: string }

export abstract class PrSubscriptionLinks {
  abstract syncFromEvents(args: {
    userId: string
    threadId: string
    events: readonly PrSubscriptionLinkEventRow[]
  }): Promise<void>
  abstract endForThreads(args: {
    userId: string
    threadIds: readonly string[]
    activeTargets: ReadonlyMap<string, readonly { repoFullName: string; prNumber: number }[]>
  }): Promise<void>
}
