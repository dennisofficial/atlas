import { createHash } from 'node:crypto'

import { toThreadId, type ThreadId } from '@dltech/atlas-core'

const uuidShapedOf = (hex: string): string =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`

export const spawnAgentIdOf = (args: { parentThreadId: ThreadId; stepKey: string }): ThreadId => {
  const digest = createHash('sha256')
    .update(`${args.parentThreadId}\0${args.stepKey}`)
    .digest('hex')
  return toThreadId(`brn_${uuidShapedOf(digest)}`)
}
