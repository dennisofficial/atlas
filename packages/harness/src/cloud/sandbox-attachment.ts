import { randomBytes } from 'node:crypto'

import type { SecretsPort, ThreadId } from '@dltech/atlas-core'

export const SANDBOX_SERVE_TOKEN_PREFIX = 'sandbox-serve'

export const sandboxServeTokenName = (threadId: ThreadId): string =>
  `${SANDBOX_SERVE_TOKEN_PREFIX}:${threadId}`

/**
 * Written before the answer returns so a crash after minting cannot strand a token the sandbox
 * already runs with.
 */
export function sandboxServeTokenFor(args: {
  secrets: SecretsPort
  threadId: ThreadId
}): string {
  const name = sandboxServeTokenName(args.threadId)
  const held = args.secrets.read(name)
  if (held !== undefined && held.length > 0) return held

  const minted = randomBytes(32).toString('hex')
  args.secrets.write({ name, value: minted })
  return minted
}
