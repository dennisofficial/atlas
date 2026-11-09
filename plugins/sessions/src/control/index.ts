import type { ControlCommandHandler } from '@dltech/atlas-commands'
import type { ControlSlot } from '@dltech/atlas-plugin-sdk'

import { resetPeerBudgetCommand } from '../core'

export * from '../core'

export type PeerBudgetPlane = {
  resetPeerBudget(args: { sessionId: string }): Promise<boolean>
}

export const resetPeerBudget: ControlCommandHandler<PeerBudgetPlane, unknown> = async ({
  plane,
  sessionId,
}) => {
  const reset = await plane.resetPeerBudget({ sessionId })
  if (!reset) throw new Error(`session ${sessionId} has no peer to reset`)
}

export const sessionsControl: ControlSlot = {
  hooks: [],
  commands: new Map([[resetPeerBudgetCommand.spec.name, resetPeerBudget]]),
}
