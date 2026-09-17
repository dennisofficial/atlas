import type { ThreadId } from '@dltech/atlas-core'

import { ECloudSandboxState, type CloudSandboxes } from './cloud-bridge'

const DEFAULT_TIMEOUT_MS = 8 * 60 * 1000
const DEFAULT_INTERVAL_MS = 2000

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The API answers `create()` with a token before the sandbox is provisioned, so a cold start is a
 * poll rather than a single round trip. A `find` that comes back `undefined` means the row is
 * gone, which is how a failed background provision surfaces.
 */
export async function waitForSandbox(args: {
  sandboxes: CloudSandboxes
  threadId: ThreadId
  timeoutMs?: number | undefined
  intervalMs?: number | undefined
  sleep?: ((ms: number) => Promise<void>) | undefined
  now?: (() => number) | undefined
}): Promise<{ url: string }> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const intervalMs = args.intervalMs ?? DEFAULT_INTERVAL_MS
  const sleep = args.sleep ?? defaultSleep
  const now = args.now ?? Date.now
  const deadline = now() + timeoutMs

  while (true) {
    const status = await args.sandboxes.find({ threadId: args.threadId })
    if (status === undefined) {
      throw new Error(`the sandbox for ${args.threadId} failed to start`)
    }
    if (status.state === ECloudSandboxState.Running && status.url !== undefined) {
      return { url: status.url }
    }
    if (now() >= deadline) {
      throw new Error(`timed out waiting for the sandbox for ${args.threadId} to start`)
    }
    await sleep(intervalMs)
  }
}
