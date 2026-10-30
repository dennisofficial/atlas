import { describe, expect, it } from 'bun:test'

import { toThreadId } from '@dltech/atlas-core'
import type { ChannelSignal } from '@dltech/atlas-harness'
import { EStepEnd } from '@dltech/atlas-wire'

import { bindChildActivity } from '../serve-activity-binding'
import { httpSendActivity, type ActivityState } from '../serve-activity-reporter'
import { trpcOk, trpcUrl } from './trpc-fake'

const child = toThreadId('child-a')

const arrange = () => {
  let emit: (signal: ChannelSignal) => void = () => undefined
  let subscribedTo: string | undefined
  const states: ActivityState[] = []
  const binding = bindChildActivity({
    threadId: child,
    remote: {
      controlPlaneUrl: 'http://api',
      token: 't',
      clientVersion: '0',
      fetchFn: fetch,
    },
    log: () => undefined,
    reporter: {
      report: (state) => states.push(state),
      whenIdle: async () => undefined,
    },
    channel: {
      subscribe: ({ threadId, listener }) => {
        subscribedTo = threadId
        emit = listener
        return () => {
          emit = () => undefined
        }
      },
    },
  })
  return {
    binding,
    states,
    emit: (signal: ChannelSignal) => emit(signal),
    subscribedTo: () => subscribedTo,
  }
}

describe('bindChildActivity', () => {
  it('reports working on turn-working and the outcome when it ends', () => {
    const h = arrange()

    h.emit({ type: 'turn-working', working: true })
    h.emit({ type: 'turn-working', working: false })

    expect(h.subscribedTo()).toBe('child-a')
    expect(h.states[0]).toEqual({ working: true, awaiting: null })
    expect(h.states[1]?.working).toBe(false)
  })

  it('records a failed step as the last outcome', () => {
    const h = arrange()

    h.emit({ type: 'turn-working', working: true })
    h.emit({
      type: 'step-ended',
      stepId: 's' as never,
      end: EStepEnd.Failed,
      supersededBy: null,
    })
    h.emit({ type: 'turn-working', working: false })

    expect(h.states.at(-1)).toEqual({
      working: false,
      awaiting: null,
      lastOutcome: 'failed',
    })
  })

  it('reports awaiting input and stops after detach', () => {
    const h = arrange()

    h.emit({ type: 'operator-input', request: {} as never })
    expect(h.states.at(-1)?.awaiting).toBe('input')
    h.binding.detach()
    h.emit({ type: 'turn-working', working: true })

    expect(h.states).toHaveLength(1)
  })

  it('sends the child threadId to the activity route', async () => {
    const bodies: unknown[] = []
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        trpcUrl({
          controlPlaneUrl: 'http://api',
          procedure: 'sandboxSelf.activity',
        }),
      )
      bodies.push(JSON.parse(String(init?.body)))
      return trpcOk(null)
    }) as unknown as typeof fetch
    const send = httpSendActivity({
      remote: {
        controlPlaneUrl: 'http://api',
        token: 't',
        clientVersion: '0',
        fetchFn,
      },
      threadId: child,
    })

    await send({ working: true, awaiting: null })

    expect(bodies).toEqual([{ threadId: 'child-a', working: true, awaiting: null }])
  })
})
