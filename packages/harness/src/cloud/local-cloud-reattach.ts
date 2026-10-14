import type { ThreadId } from '@dltech/atlas-core'

import type { CloudSandboxes } from './cloud-bridge'

export async function reattachSandbox(args: {
  sandboxes: CloudSandboxes
  threadId: ThreadId
}): Promise<{ url: string; token: string }> {
  const woken = await args.sandboxes.create({ threadId: args.threadId, workspace: null })
  return { url: woken.url, token: woken.token }
}
