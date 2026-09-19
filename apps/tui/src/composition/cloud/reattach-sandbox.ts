import type { ThreadId } from '@dltech/atlas-core'

import type { CloudSandboxes } from './cloud-bridge'
import { waitForSandbox } from './wait-for-sandbox'

export async function reattachSandbox(args: {
  sandboxes: CloudSandboxes
  threadId: ThreadId
  sleep?: ((ms: number) => Promise<void>) | undefined
}): Promise<{ url: string; token: string }> {
  const woken = await args.sandboxes.create({ threadId: args.threadId, workspace: null })
  const ready = await waitForSandbox({
    sandboxes: args.sandboxes,
    threadId: args.threadId,
    ...(args.sleep === undefined ? {} : { sleep: args.sleep }),
  })
  return { url: ready.url, token: woken.token }
}
