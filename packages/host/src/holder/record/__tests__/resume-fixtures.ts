import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import {
  chainEvents,
  spillBody,
  toRunId,
  toThreadId,
  type LogHead,
  type RecordEvent,
  type RecordEventBody,
} from '@dltech/atlas-core'

export const SESSION = 'session-1'
export const THREAD = toThreadId('thread-1')
export const AT = '2026-11-06T12:00:00.000Z'

export const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

export const answered = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

export const transcriptOf = (count: number): RecordEventBody[] =>
  Array.from({ length: count }, (_, index) =>
    index % 2 === 0 ? said(`ask ${index}`) : answered(`reply ${index}`),
  )

export const openThread = async (): Promise<{ plane: ControlPlane; epoch: number }> => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => AT }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'project-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  return { plane, epoch }
}

export const appendTo = async (args: {
  plane: ControlPlane
  epoch: number
  bodies: readonly RecordEventBody[]
  blobs?: readonly { hash: string; bytes: Uint8Array }[] | undefined
}): Promise<{ head: LogHead; events: RecordEvent[] }> => {
  const from = await args.plane.head({ threadId: THREAD })
  const events = chainEvents({
    threadId: THREAD,
    runId: toRunId('run-1'),
    epoch: args.epoch,
    at: AT,
    bodies: args.bodies,
    from,
  })
  const outcome = await args.plane.append({
    threadId: THREAD,
    epoch: args.epoch,
    events,
    blobs: args.blobs ?? [],
  })
  if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  return { head: outcome.head, events }
}

export const appendSpilled = async (args: {
  plane: ControlPlane
  epoch: number
  body: RecordEventBody
  thresholdBytes: number
}): Promise<{ head: LogHead; events: RecordEvent[] }> => {
  const spilled = spillBody({ body: args.body, thresholdBytes: args.thresholdBytes })
  return appendTo({
    plane: args.plane,
    epoch: args.epoch,
    bodies: [spilled.body],
    blobs: spilled.blobs,
  })
}

export type ReadPage = Awaited<ReturnType<ControlPlane['readEvents']>>
export type ReadParams = Parameters<ControlPlane['readEvents']>[0]

export type Probe = {
  plane: ControlPlane
  reads: number[]
  head: LogHead | undefined
  trap: ((page: ReadPage, index: number) => ReadPage) | undefined
}

export const probeOf = (plane: ControlPlane): Probe => {
  const probe: Probe = { plane, reads: [], head: undefined, trap: undefined }
  probe.plane = new Proxy(plane, {
    get: (target, key, receiver) => {
      if (key === 'head' && probe.head !== undefined) return async () => probe.head
      if (key !== 'readEvents') return Reflect.get(target, key, receiver)
      return async (params: ReadParams) => {
        const index = probe.reads.push(params.afterSeq)
        const page = await target.readEvents(params)
        return probe.trap === undefined ? page : probe.trap(page, index)
      }
    },
  })
  return probe
}
