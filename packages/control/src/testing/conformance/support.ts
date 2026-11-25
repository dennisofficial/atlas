import {
  chainEvents,
  toRunId,
  toThreadId,
  type LogHead,
  type PluginViewFold,
  type RecordEventBody,
  type RecordEvent,
  type RecordEventType,
} from '@dltech/atlas-core'

import type { AppendHook } from '../../append-hooks'
import { ControlPlane } from '../../control-plane'
import type { z } from 'zod'

import type { ControlStorePort } from '../../port'
import type { ViewChangeHook } from '../../view-hooks'

export const SESSION = 'session-1'
export const THREAD = 'thread-1'
export const HOLDER_HOST = 9001
export const USER = 'user-1'
export const PROJECT = 'project-1'
export const T0 = '2026-11-02T12:00:00.000Z'

export type Harness = { plane: ControlPlane; setNow: (iso: string) => void }

export function makeHarness(
  store: ControlStorePort,
  eventSchema?: z.ZodType<RecordEvent> | undefined,
  options?: {
    pluginViews?: readonly PluginViewFold[] | undefined
    appendHooks?: readonly AppendHook[] | undefined
    viewHooks?: readonly ViewChangeHook[] | undefined
  },
): Harness {
  let now = T0
  const plane = new ControlPlane({
    store,
    clock: () => now,
    ...(eventSchema === undefined ? {} : { eventSchema }),
    pluginViews: options?.pluginViews,
    appendHooks: options?.appendHooks,
    viewHooks: options?.viewHooks,
  })
  return { plane, setNow: (iso) => (now = iso) }
}

export async function seedGranted(harness: Harness): Promise<number> {
  await harness.plane.createSession({
    sessionId: SESSION,
    userId: USER,
    projectId: PROJECT,
    mainThreadId: THREAD,
  })
  const lease = await harness.plane.grant({ sessionId: SESSION, hostId: HOLDER_HOST })
  return lease.epoch
}

export const createSessionParams = (params: {
  sessionId: string
  mainThreadId: string
  title?: string
}): {
  sessionId: string
  userId: string
  projectId: string | null
  title?: string
  mainThreadId: string
  sandboxProvider: string
  sandboxInstanceId: string | null
} => ({
  ...params,
  userId: USER,
  projectId: PROJECT,
  sandboxProvider: 'vercel',
  sandboxInstanceId: null,
})

export const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

export const mint = (params: {
  bodies: readonly RecordEventBody[]
  epoch: number
  from?: LogHead | undefined
  threadId?: string | undefined
}): RecordEvent[] =>
  chainEvents({
    threadId: toThreadId(params.threadId ?? THREAD),
    runId: toRunId('run-1'),
    epoch: params.epoch,
    at: T0,
    bodies: params.bodies,
    from: params.from,
  })

export async function appendBodies(params: {
  harness: Harness
  bodies: readonly RecordEventBody[]
  epoch: number
}) {
  const head = await params.harness.plane.head({ threadId: THREAD })
  const events = mint({ bodies: params.bodies, epoch: params.epoch, from: head })
  const outcome = await params.harness.plane.append({
    threadId: THREAD,
    epoch: params.epoch,
    events,
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return { events, head: outcome.head }
}

export async function readAll(params: {
  harness: Harness
  visible: boolean
  limit?: number
  hiddenTypes?: readonly RecordEventType[]
}) {
  const out: RecordEvent[] = []
  let afterSeq = 0
  for (;;) {
    const page = await params.harness.plane.readEvents({
      threadId: THREAD,
      afterSeq,
      limit: params.limit ?? 1000,
      visible: params.visible,
      hiddenTypes: params.hiddenTypes,
    })
    out.push(...page.events)
    if (page.next === undefined) return out
    afterSeq = page.next
  }
}
