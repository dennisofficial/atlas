import {
  EKilledBy,
  EServiceStatus,
  EShellEndCause,
  EShellStatus,
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  inboxEventPayloadOf,
  lostServicesOf,
  lostShellsOf,
  type Event,
  type EventBody,
  type V2Event,
} from '@dltech/atlas-core'

import { postIn } from './inbox-ops'
import type { ControlStorePort, ControlTx } from './port'
import { decodeStoredEvent } from './stored-event'

const QUIET_EVENT_TYPES = [
  'background-shell-started',
  'background-shell-ended',
  'service-started',
  'service-ended',
]

const READ_EVENTS_PAGE = 1000

export type QuietEndingRecord = { kind: string; payload: string; clientId: string }

const recordOf = (args: {
  kind: string
  event: EventBody
  clientId: string
}): QuietEndingRecord => ({
  kind: args.kind,
  payload: inboxEventPayloadOf({ event: args.event, clientId: args.clientId }),
  clientId: args.clientId,
})

const shellEndingOf = (shell: ReturnType<typeof lostShellsOf>[number]): QuietEndingRecord =>
  recordOf({
    kind: INBOX_KIND_EVENT,
    clientId: `background-shell-ended:${shell.shellId}`,
    event: {
      type: 'background-shell-ended',
      shellId: shell.shellId,
      command: shell.command,
      ...(shell.description === undefined ? {} : { description: shell.description }),
      ...(shell.bootId === undefined ? {} : { bootId: shell.bootId }),
      status: EShellStatus.Killed,
      killedBy: EKilledBy.Unrecorded,
      cause: EShellEndCause.SandboxStopped,
      output: '',
      droppedCharacters: 0,
      remainingCharacters: 0,
    },
  })

const serviceEndingOf = (service: ReturnType<typeof lostServicesOf>[number]): QuietEndingRecord =>
  recordOf({
    kind: INBOX_KIND_RECORD,
    clientId: `service-ended:${service.started.serviceId}`,
    event: {
      type: 'service-ended',
      serviceId: service.started.serviceId,
      command: service.started.command,
      ...(service.started.description === undefined
        ? {}
        : { description: service.started.description }),
      ...(service.started.bootId === undefined ? {} : { bootId: service.started.bootId }),
      status: EServiceStatus.Killed,
      killedBy: EKilledBy.Unrecorded,
      cause: EShellEndCause.SandboxStopped,
      tail: '',
    },
  })

export const quietEndingRecordsOf = (events: readonly V2Event[]): QuietEndingRecord[] => {
  const log = events as readonly Event[]
  return [...lostShellsOf(log).map(shellEndingOf), ...lostServicesOf(log).map(serviceEndingOf)]
}

const threadEventsOf = async (params: { tx: ControlTx; threadId: string }): Promise<V2Event[]> => {
  const head = await params.tx.readThread(params.threadId)
  if (head === undefined) return []
  const events: V2Event[] = []
  for (let afterSeq = 0; afterSeq < head.headSeq; ) {
    const rows = await params.tx.readEvents({
      threadId: params.threadId,
      afterSeq,
      throughSeq: head.headSeq,
      limit: READ_EVENTS_PAGE,
      onlyTypes: QUIET_EVENT_TYPES,
    })
    const last = rows[rows.length - 1]
    if (last === undefined) break
    events.push(...rows.map((row) => decodeStoredEvent(row)))
    afterSeq = last.seq
  }
  return events
}

export const postQuietEndingsOf = async (params: {
  store: ControlStorePort
  sessionId: string
  mainThreadId: string
  at: string
}): Promise<number> =>
  await params.store.transact(async (tx) => {
    const records = quietEndingRecordsOf(
      await threadEventsOf({ tx, threadId: params.mainThreadId }),
    )
    for (const record of records) {
      await postIn({
        tx,
        sessionId: params.sessionId,
        kind: record.kind,
        payload: record.payload,
        at: params.at,
        wake: record.kind !== INBOX_KIND_RECORD,
      })
    }
    return records.length
  })
