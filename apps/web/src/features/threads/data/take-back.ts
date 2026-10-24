import { z } from 'zod'

import { EPodState, type WireEvent } from '@dltech/atlas-wire/web'

import { CloudApiError } from '@/lib/cloud-api'

import { coreEventsOf } from './transcript'
import { takeBackMessage } from './threads-api'

const USER_SAID = 'user-said'
const CONFLICT = 409

export enum ETakeBackOutcome {
  TakenBack = 'taken-back',
  TooLate = 'too-late',
}

export type TakeBackTarget = { sendId: string; text: string }

const userBodySchema = z.object({ text: z.string(), requestId: z.string().optional() })

export function userBodyOf(event: WireEvent): z.infer<typeof userBodySchema> | null {
  if (event.type !== USER_SAID) return null
  try {
    const parsed = userBodySchema.safeParse(JSON.parse(event.body))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const lastCoreOf = (events: readonly WireEvent[]): WireEvent | undefined =>
  coreEventsOf(events)
    .sort((left, right) => left.seq - right.seq)
    .at(-1)

export const awaitingRunOf = (events: readonly WireEvent[]): boolean => {
  const last = lastCoreOf(events)
  return last !== undefined && last.type === USER_SAID
}

export function takeBackTargetOf(args: {
  events: readonly WireEvent[]
  podState: EPodState | null
}): TakeBackTarget | null {
  if (args.podState === null) return null
  if (args.podState === EPodState.Running || args.podState === EPodState.Parked) return null
  const last = lastCoreOf(args.events)
  const body = last === undefined ? null : userBodyOf(last)
  if (body === null || body.requestId === undefined) return null
  return { sendId: body.requestId, text: body.text }
}

export function restoredDraftOf(args: { current: string; restored: string }): string {
  return args.current.trim().length === 0 ? args.restored : `${args.restored}\n\n${args.current}`
}

export function withoutTakenBack(args: {
  events: WireEvent[]
  sendIds: ReadonlySet<string>
}): WireEvent[] {
  if (args.sendIds.size === 0) return args.events
  return args.events.filter((event) => {
    const requestId = userBodyOf(event)?.requestId
    return requestId === undefined || !args.sendIds.has(requestId)
  })
}

export async function takeBack(args: {
  threadId: string
  sendId: string
}): Promise<ETakeBackOutcome> {
  try {
    await takeBackMessage(args)
    return ETakeBackOutcome.TakenBack
  } catch (failure) {
    if (failure instanceof CloudApiError && failure.status === CONFLICT) {
      return ETakeBackOutcome.TooLate
    }
    throw failure
  }
}
