import type { ScheduledRetry } from '@dltech/atlas-core'

export abstract class OnceLedger {
  abstract once<T>(args: { key: string; decide: () => Promise<T> }): Promise<T>
  abstract recall(args: { prefix: string }): Promise<readonly { key: string; value: unknown }[]>
  abstract scheduleRetry(args: {
    key: string
    decide: () => Promise<Omit<ScheduledRetry, 'key'>>
  }): Promise<ScheduledRetry>
  abstract recallRetries(args: { prefix: string }): Promise<readonly ScheduledRetry[]>
}
