import { describe, expect, it } from 'vitest'

import { EBeforeToolDecision, EStage, type EventDraft } from '@dltech/atlas-core'

import { HookChain } from '../../hooks/registry'
import { HookedToolDispatcher } from '../dispatch'
import { InMemoryToolRegistry } from '../registry'
import { readCall, toolNamed } from './fixtures'

const SESSION_DIRECTORY = '/workspace'

describe('the dispatch marker', () => {
  it('reaches the appender with the call id and name before the tool runs', async () => {
    const order: string[] = []
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        toolNamed({
          name: 'read',
          invoke: async () => {
            order.push('invoked')
            return { ok: true, output: 'bytes', modelText: 'rendered' }
          },
        }),
      ]),
      hooks: new HookChain({}),
    })

    const markers: EventDraft[] = []
    const drafts = await dispatcher.dispatch({
      call: readCall,
      signal: new AbortController().signal,
      projectDirectory: SESSION_DIRECTORY,
      events: [],
      onDispatchStarted: async (draft) => {
        order.push('marked')
        markers.push(draft)
      },
    })

    expect(order).toEqual(['marked', 'invoked'])
    expect(markers).toEqual([{ type: 'tool-dispatched', callId: readCall.callId, name: 'read' }])
    expect(drafts.some((draft) => draft.type === 'tool-result')).toBe(true)
  })

  it('turns a marker append failure into an error result and never runs the tool', async () => {
    let invoked = false
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        toolNamed({
          name: 'read',
          invoke: async () => {
            invoked = true
            return { ok: true, output: 'bytes', modelText: 'rendered' }
          },
        }),
      ]),
      hooks: new HookChain({}),
    })

    const drafts = await dispatcher.dispatch({
      call: readCall,
      signal: new AbortController().signal,
      projectDirectory: SESSION_DIRECTORY,
      events: [],
      onDispatchStarted: async () => {
        throw new Error('disk full')
      },
    })

    expect(invoked).toBe(false)
    expect(drafts).toHaveLength(1)
    const result = drafts[0]
    expect(result?.type).toBe('tool-result')
    if (result?.type !== 'tool-result') return
    expect(result.error?.message).toContain('did not persist')
    expect(result.error?.message).toContain('disk full')
  })

  it('runs without a marker when no appender is wired', async () => {
    let invoked = false
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        toolNamed({
          name: 'read',
          invoke: async () => {
            invoked = true
            return { ok: true, output: 'bytes', modelText: 'rendered' }
          },
        }),
      ]),
      hooks: new HookChain({}),
    })

    await dispatcher.dispatch({
      call: readCall,
      signal: new AbortController().signal,
      projectDirectory: SESSION_DIRECTORY,
      events: [],
    })

    expect(invoked).toBe(true)
  })

  it('never marks a call a hook denied', async () => {
    const dispatcher = new HookedToolDispatcher({
      registry: new InMemoryToolRegistry([
        toolNamed({ name: 'read', invoke: async () => ({ ok: true, output: '', modelText: '' }) }),
      ]),
      hooks: new HookChain({
        beforeTool: [
          {
            name: 'refuse',
            order: { stage: EStage.Guard, nudge: 0 },
            run: async () => ({ decision: EBeforeToolDecision.Deny, reason: 'not today' }),
          },
        ],
      }),
    })

    let marked = false
    const drafts = await dispatcher.dispatch({
      call: readCall,
      signal: new AbortController().signal,
      projectDirectory: SESSION_DIRECTORY,
      events: [],
      onDispatchStarted: async () => {
        marked = true
      },
    })

    expect(marked).toBe(false)
    expect(drafts.some((draft) => draft.type === 'tool-denied')).toBe(true)
  })
})
