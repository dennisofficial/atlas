import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

export const resetPeerBudgetArgs = z.strictObject({})

export const resetPeerBudgetCommand = defineCommand({
  spec: {
    name: 'reset-peer-budget',
    summary: 'give this peer session another 20 messages from its spawner',
    group: ECommandGroup.Session,
    args: resetPeerBudgetArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'control',
  },
})
