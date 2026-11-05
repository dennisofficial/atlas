import {
  chainEvents,
  toRunId,
  toThreadId,
  type LogHead,
  type V2Body,
  type V2Event,
} from '@dltech/atlas-core'

import { ControlPlane } from '../../control-plane'
import type { ControlStorePort } from '../../port'

export const SESSION = 'session-1'
export const THREAD = 'thread-1'
export const HOLDER_HOST = 9001
export const USER = 'user-1'
export const PROJECT = 'project-1'
export const T0 = '2026-11-02T12:00:00.000Z'

export type Harness = { plane: ControlPlane; setNow: (iso: string) => void }

export function makeHarness(store: ControlStorePort): Harness {
  let now = T0
  const plane = new ControlPlane({ store, clock: () => now })
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
  projectId: string
  title?: string
  mainThreadId: string
} => ({
  ...params,
  userId: USER,
  projectId: PROJECT,
})

export const said = (text: string): V2Body => ({ type: 'user-said', text })

export const mint = (params: {
  bodies: readonly V2Body[]
  epoch: number
  from?: LogHead | undefined
  threadId?: string | undefined
}): V2Event[] =>
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
  bodies: readonly V2Body[]
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

export async function readAll(params: { harness: Harness; visible: boolean; limit?: number }) {
  const out: V2Event[] = []
  let afterSeq = 0
  for (;;) {
    const page = await params.harness.plane.readEvents({
      threadId: THREAD,
      afterSeq,
      limit: params.limit ?? 1000,
      visible: params.visible,
    })
    out.push(...page.events)
    if (page.next === undefined) return out
    afterSeq = page.next
  }
}
