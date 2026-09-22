import type { ThreadId } from '@dltech/atlas-core'

import type { CloudSandboxes } from './cloud-bridge'

/**
 * Re-claiming is re-provisioning: the claim mints a fresh session token and git credential, and
 * `create` awaits the sandbox actually running before answering, so its result attaches directly.
 */
export async function reattachSandbox(args: {
  sandboxes: CloudSandboxes
  threadId: ThreadId
}): Promise<{ url: string; token: string }> {
  const woken = await args.sandboxes.create({ threadId: args.threadId, workspace: null })
  return { url: woken.url, token: woken.token }
}
