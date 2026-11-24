import { describe, expect, it } from 'bun:test'

import {
  EKilledBy,
  EServiceStatus,
  EShellEndCause,
  EShellStatus,
  INBOX_KIND_EVENT,
  INBOX_KIND_RECORD,
  inboxEventOf,
  type EventBody,
} from '@dltech/atlas-core'

import { ControlPlane } from '../src/control-plane'
import { InMemoryControlStore } from '../src/testing/memory'
import { HOLDER_HOST, T0, createSessionParams, mint } from '../src/testing/conformance/support'
import { postQuietEndingsOf, quietEndingRecordsOf } from '../src/quiet-endings'

const SHELL_STARTED: EventBody = {
  type: 'background-shell-started',
  shellId: 'bash_1',
  command: 'bun test',
}

const SERVICE_STARTED: EventBody = {
  type: 'service-started',
  serviceId: 'svc_1',
  command: 'bun dev',
}

const TWO_SHELLS_ONE_SERVICE = [
  { type: 'background-shell-started' as const, shellId: 'bash_1', command: 'bun test' },
  { type: 'background-shell-started' as const, shellId: 'bash_2', command: 'bun run build' },
  { type: 'service-started' as const, serviceId: 'svc_1', command: 'bun dev' },
]

const allEnded = (ends: readonly EventBody[]) =>
  mint({ bodies: [...TWO_SHELLS_ONE_SERVICE, ...ends] as never, epoch: 1 })

const shellEnded = (shellId: string): EventBody => ({
  type: 'background-shell-ended',
  shellId,
  command: 'bun test',
  status: EShellStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  cause: EShellEndCause.SandboxStopped,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const serviceEnded = (serviceId: string): EventBody => ({
  type: 'service-ended',
  serviceId,
  command: 'bun dev',
  status: EServiceStatus.Killed,
  killedBy: EKilledBy.Unrecorded,
  cause: EShellEndCause.SandboxStopped,
  tail: '',
})

describe('quiet ending records of a closed sandbox', () => {
  it('makes one record entry per unit the log still holds open', () => {
    const records = quietEndingRecordsOf(mint({ bodies: TWO_SHELLS_ONE_SERVICE, epoch: 1 }))

    expect(records.map((record) => record.clientId)).toEqual([
      'background-shell-ended:bash_1',
      'background-shell-ended:bash_2',
      'service-ended:svc_1',
    ])
    const events = records.map((record) => inboxEventOf(record.payload))
    expect(events.every((read) => read.ok)).toBe(true)
    const bodies = events.flatMap((read) => (read.ok ? [read.event] : []))
    expect(bodies).toMatchObject([
      { type: 'background-shell-ended', shellId: 'bash_1', cause: EShellEndCause.SandboxStopped },
      { type: 'background-shell-ended', shellId: 'bash_2', cause: EShellEndCause.SandboxStopped },
      { type: 'service-ended', serviceId: 'svc_1', cause: EShellEndCause.SandboxStopped },
    ])
  })

  it('posts nothing for a second close once the endings are in the log', () => {
    const records = quietEndingRecordsOf(
      allEnded([shellEnded('bash_1'), shellEnded('bash_2'), serviceEnded('svc_1')]),
    )

    expect(records).toEqual([])
  })

  it('leaves a unit alone while its start still has no end', () => {
    const records = quietEndingRecordsOf(allEnded([shellEnded('bash_1')]))

    expect(records.map((record) => record.clientId)).toEqual([
      'background-shell-ended:bash_2',
      'service-ended:svc_1',
    ])
  })
})

describe('the kind a quiet ending is posted as', () => {
  it('posts a shell ending as an event, so it asks for a holder and wakes the agent', () => {
    const records = quietEndingRecordsOf(mint({ bodies: TWO_SHELLS_ONE_SERVICE, epoch: 1 }))

    expect(records.map((record) => [record.clientId, record.kind])).toEqual([
      ['background-shell-ended:bash_1', INBOX_KIND_EVENT],
      ['background-shell-ended:bash_2', INBOX_KIND_EVENT],
      ['service-ended:svc_1', INBOX_KIND_RECORD],
    ])
  })
})

describe('posting the quiet endings of a stopped sandbox', () => {
  const SESSION_ID = 'ses-stopped'
  const THREAD_ID = 'thread-stopped'

  const sessionWith = async (bodies: readonly EventBody[]) => {
    const store = new InMemoryControlStore({ clock: () => T0 })
    const plane = new ControlPlane({ store, clock: () => T0 })
    await plane.createSession(
      createSessionParams({ sessionId: SESSION_ID, mainThreadId: THREAD_ID }),
    )
    const { epoch } = await plane.grant({ sessionId: SESSION_ID, hostId: HOLDER_HOST })
    const head = await plane.head({ threadId: THREAD_ID })
    const outcome = await plane.append({
      threadId: THREAD_ID,
      epoch,
      events: mint({
        bodies: [{ type: 'workspace-prepared' }, ...bodies] as never,
        epoch,
        from: head,
        threadId: THREAD_ID,
      }),
    })
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.refusal))
    await plane.revoke({ sessionId: SESSION_ID, wantsHolder: false })
    return { store, plane }
  }

  const claimed = async (args: { store: InMemoryControlStore; plane: ControlPlane }) => {
    const hostId = args.store.nextHostId()
    args.store.markHostPresent(hostId)
    const batch = await args.plane.claimNext({ hostId, limit: 5 })
    return batch.leases.map((lease) => lease.sessionId)
  }

  const postEndings = (store: InMemoryControlStore) =>
    postQuietEndingsOf({ store, sessionId: SESSION_ID, mainThreadId: THREAD_ID, at: T0 })

  it('asks for a holder when a shell was still open', async () => {
    const { store, plane } = await sessionWith([SHELL_STARTED])

    expect(await postEndings(store)).toBe(1)

    expect(await claimed({ store, plane })).toEqual([SESSION_ID])
    expect(store.wakeCount(SESSION_ID)).toBeGreaterThan(0)
  })

  it('asks for no holder when only a service was still open', async () => {
    const { store, plane } = await sessionWith([SERVICE_STARTED])

    expect(await postEndings(store)).toBe(1)

    expect(await claimed({ store, plane })).toEqual([])
  })

  it('posts one ending per shell when the pod reports the same loss first', async () => {
    const { store, plane } = await sessionWith([SHELL_STARTED])
    const [shellRecord] = quietEndingRecordsOf(mint({ bodies: [SHELL_STARTED] as never, epoch: 1 }))
    if (shellRecord === undefined) throw new Error('no shell record')
    await plane.post({
      sessionId: SESSION_ID,
      kind: INBOX_KIND_EVENT,
      payload: shellRecord.payload,
    })

    await postEndings(store)

    const inbox = await plane.readInbox({ sessionId: SESSION_ID, afterId: 0, limit: 10 })
    expect(inbox.map((entry) => entry.kind)).toEqual([INBOX_KIND_EVENT])
  })
})
