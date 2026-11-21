import { EAgentLostCause, toThreadId } from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import { describe, expect, it } from 'bun:test'

import { adoptRecordOf, type ChildRunArgs } from '../crew/child-record'

const AGENT = toThreadId('thread-lost-child')

const planeOf = (read: () => Promise<never> | Promise<unknown>): ControlPlane =>
  ({
    head: () => Promise.resolve({ seq: 0, hash: '' }),
    readEvents: read,
  }) as unknown as ControlPlane

const argsOf = (plane: ControlPlane): ChildRunArgs =>
  ({
    deps: { sessionId: 'session-lost', plane },
    runtime: { daemonTools: new Set<string>(), effectOf: () => 'write', remoteCalls: {} },
    parentRecord: {},
    parentThreadId: toThreadId('thread-parent'),
    epoch: 1,
    agentType: 'explore',
    intent: 'find the callers',
    signal: new AbortController().signal,
    onLeaseLost: () => undefined,
  }) as unknown as ChildRunArgs

describe('adopting a child whose record the new host cannot continue', () => {
  it('names a record it could not open as unreadable, with the reason it gave', async () => {
    const plane = planeOf(() => Promise.reject(new Error('thread brn_child is gone')))

    const adopted = await adoptRecordOf({
      args: argsOf(plane),
      agentId: AGENT,
      onLeaseLost: () => undefined,
    })

    expect(adopted).toEqual({
      ok: false,
      lost: { cause: EAgentLostCause.RecordUnreadable, detail: 'thread brn_child is gone' },
    })
  })

  it('names an empty log as never started', async () => {
    const plane = planeOf(() => Promise.resolve({ events: [], next: undefined }))

    const adopted = await adoptRecordOf({
      args: argsOf(plane),
      agentId: AGENT,
      onLeaseLost: () => undefined,
    })

    expect(adopted).toEqual({
      ok: false,
      lost: { cause: EAgentLostCause.NeverStarted, detail: 'its log holds no events' },
    })
  })
})
