export type ProductAnalyticsProperties = Record<string, unknown>

/**
 * Server-side product analytics. `capture` is fire-and-forget — posthog-node batches on its own
 * timer — so it must never throw and never wait on the network; `flush` is the process's shutdown
 * hook. Callers pass the Atlas user id as `userId`, which becomes the PostHog distinct id.
 */
export abstract class ProductAnalytics {
  abstract capture(args: {
    userId: string
    event: string
    properties?: ProductAnalyticsProperties
  }): void
  abstract flush(): Promise<void>
}

export class NullProductAnalytics extends ProductAnalytics {
  capture(): void {}
  async flush(): Promise<void> {}
}
