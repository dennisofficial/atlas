import type { ThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxes, type CloudSandboxStatus } from './cloud-bridge'

const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000
const DEFAULT_INTERVAL_MS = 2000
const DEFAULT_ERROR_BUDGET_MS = 30_000

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const messageOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : String(failure)

/**
 * The API answers `create()` with a token before the sandbox is provisioned, so a cold start is a
 * poll rather than a single round trip. A failed background provision surfaces as a thrown
 * BadGateway from the status route — but the same route also answers with the *previous* attach's
 * failure until the new attach clears it, so thrown answers get a grace window before they fail
 * the wait. `undefined` means the API holds no row for the thread at all.
 */
export async function waitForSandbox(args: {
  sandboxes: CloudSandboxes
  threadId: ThreadId
  timeoutMs?: number | undefined
  intervalMs?: number | undefined
  errorBudgetMs?: number | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  now?: (() => number) | undefined
}): Promise<{ url: string; contextPending: boolean | undefined }> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = args.intervalMs ?? DEFAULT_INTERVAL_MS
  const errorBudgetMs = args.errorBudgetMs ?? DEFAULT_ERROR_BUDGET_MS
  const sleep = args.sleep ?? defaultSleep
  const now = args.now ?? Date.now
  const deadline = now() + timeoutMs
  let failingSince: number | null = null

  while (true) {
    let status: CloudSandboxStatus | undefined
    try {
      status = await args.sandboxes.find({ threadId: args.threadId })
    } catch (failure) {
      failingSince ??= now()
      if (now() - failingSince >= errorBudgetMs) {
        throw new Error(
          `the sandbox for ${args.threadId} failed to start: ${messageOf(failure)}`,
        )
      }
      if (now() >= deadline) {
        throw new Error(`timed out waiting for the sandbox for ${args.threadId} to start`)
      }
      await sleep(intervalMs)
      continue
    }

    failingSince = null
    if (status === undefined) {
      throw new Error(`the sandbox for ${args.threadId} failed to start`)
    }
    if (status.state === ECloudSandboxState.Running && status.url !== undefined) {
      return { url: status.url, contextPending: status.contextPending }
    }
    if (now() >= deadline) {
      throw new Error(`timed out waiting for the sandbox for ${args.threadId} to start`)
    }
    await sleep(intervalMs)
  }
}
