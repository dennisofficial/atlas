import { defineCommand, ECommandGroup, ECommandRunsIn, type TextArgs } from '@dltech/atlas-commands'
import { z } from 'zod'

import { EServiceAction } from '../pod/schema'

export const serviceArgs = z.strictObject({
  action: z.enum([EServiceAction.Stop, EServiceAction.Restart]),
  serviceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
})

export type ServiceCommandArgs = z.infer<typeof serviceArgs>

export const REFUSAL_SERVICE_ACTION = 'Use /service stop <id> or /service restart <id>'
export const REFUSAL_SERVICE_TARGET = 'Name the service: /service stop <id>'

const ACTIONS: readonly string[] = [EServiceAction.Stop, EServiceAction.Restart]

const serviceFromText = (argumentText: string): TextArgs => {
  const parts = argumentText
    .trim()
    .split(/\s+/)
    .filter((part) => part !== '')
  const [action, serviceId] = parts
  if (parts.length > 2) return { ok: false, reason: REFUSAL_SERVICE_ACTION }
  if (action === undefined || !ACTIONS.includes(action)) {
    return { ok: false, reason: REFUSAL_SERVICE_ACTION }
  }
  if (serviceId === undefined) return { ok: false, reason: REFUSAL_SERVICE_TARGET }
  return { ok: true, args: { action: action as EServiceAction, serviceId } }
}

export const service = defineCommand({
  spec: {
    name: 'service',
    summary: 'Stop or restart a service',
    group: ECommandGroup.Session,
    argumentHint: '<stop|restart> <id>',
    args: serviceArgs,
    runsIn: ECommandRunsIn.Host,
    fromText: serviceFromText,
    listed: false,
  },
})

export const serviceCommands = [service]
