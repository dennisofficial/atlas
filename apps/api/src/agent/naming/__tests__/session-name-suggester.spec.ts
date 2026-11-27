import { describe, expect, it } from 'bun:test'
import { ControlPlane } from '@dltech/atlas-control'
import { InMemoryControlStore } from '@dltech/atlas-control/testing'
import { chainEvents, toRunId, toThreadId, type RecordEventBody } from '@dltech/atlas-core'

import type { SessionNamer } from '../session-namer'
import { RECENT_SEQ_WINDOW, sessionNameSuggesterOf } from '../session-name-suggester'

const SESSION = 'session-1'
const THREAD = 'thread-1'

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })
const replied = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const fact = (key: string): RecordEventBody => ({ type: 'fact-recorded', key, kind: 'note' })

const seeded = async (bodies: readonly RecordEventBody[]) => {
  const plane = new ControlPlane({ store: new InMemoryControlStore({ clock: () => 'now' }) })
  await plane.createSession({
    sessionId: SESSION,
    userId: 'user-1',
    projectId: 'proj-1',
    mainThreadId: THREAD,
  })
  const { epoch } = await plane.grant({ sessionId: SESSION, hostId: 1 })
  if (bodies.length > 0) {
    const outcome = await plane.append({
      threadId: THREAD,
      epoch,
      events: chainEvents({
        threadId: toThreadId(THREAD),
        runId: toRunId('run-1'),
        epoch,
        at: '2026-11-27T00:00:00.000Z',
        bodies,
        from: await plane.head({ threadId: THREAD }),
      }),
    })
    if (!outcome.ok) throw new Error(`append refused: ${JSON.stringify(outcome.refusal)}`)
  }
  return plane
}

const recordingNamer = (answer: string | null) => {
  const asks: Parameters<SessionNamer>[0][] = []
  const namer: SessionNamer = async (ask) => {
    asks.push(ask)
    return answer
  }
  return { namer, asks }
}

describe('sessionNameSuggesterOf', () => {
  it('names the session from its conversation, with the session owner and model', async () => {
    const plane = await seeded([said('fix the login page'), fact('a'), replied('Fixed it')])
    const { namer, asks } = recordingNamer('Login Page Fix')
    const suggest = sessionNameSuggesterOf({ plane, namer })

    expect(await suggest({ sessionId: SESSION })).toBe('Login Page Fix')
    const session = await plane.readSession({ sessionId: SESSION })
    expect(asks).toHaveLength(1)
    expect(asks[0]).toMatchObject({
      userId: 'user-1',
      projectId: 'proj-1',
      modelRef: session?.modelRef,
      text: 'Operator: fix the login page\nAtlas: Fixed it',
    })
    expect(asks[0]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('keeps the opening message when it is older than the recent window', async () => {
    const filler = Array.from({ length: RECENT_SEQ_WINDOW + 5 }, (_, index) => fact(`f${index}`))
    const plane = await seeded([
      said('fix the login page'),
      ...filler,
      said('now port the sidebar'),
    ])
    const { namer, asks } = recordingNamer('Sidebar Port')

    await sessionNameSuggesterOf({ plane, namer })({ sessionId: SESSION })

    expect(asks[0]?.text).toBe('Operator: fix the login page\nOperator: now port the sidebar')
  })

  it('answers null without asking the model when nothing was said', async () => {
    const plane = await seeded([fact('a')])
    const { namer, asks } = recordingNamer('Unused')

    expect(await sessionNameSuggesterOf({ plane, namer })({ sessionId: SESSION })).toBeNull()
    expect(asks).toEqual([])
  })

  it('answers null for an unknown session', async () => {
    const plane = await seeded([])
    const { namer } = recordingNamer('Unused')

    expect(await sessionNameSuggesterOf({ plane, namer })({ sessionId: 'nope' })).toBeNull()
  })
})
