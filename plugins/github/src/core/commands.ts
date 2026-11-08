import { defineCommand } from '@dltech/atlas-commands'
import { ECommandGroup, ECommandTiming } from '@dltech/atlas-core'
import { z } from 'zod'

export const subscribeArgs = z.strictObject({
  provider: z.string().min(1),
  target: z.string().optional(),
  expiresAt: z.string().min(1).optional(),
})

export const unsubscribeArgs = z.strictObject({ subscriptionId: z.string().min(1) })

export const subscribeCommand = defineCommand({
  spec: {
    name: 'subscribe',
    summary: 'subscribe this session to a pull request',
    group: ECommandGroup.Session,
    args: subscribeArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})

export const unsubscribeCommand = defineCommand({
  spec: {
    name: 'unsubscribe',
    summary: "end one of this session's subscriptions",
    group: ECommandGroup.Session,
    args: unsubscribeArgs,
    timing: ECommandTiming.Settled,
    handledIn: 'pod',
  },
})
