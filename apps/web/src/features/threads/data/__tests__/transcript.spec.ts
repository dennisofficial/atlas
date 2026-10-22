import { describe, expect, it } from 'bun:test'

import {
  BOOT_STEP_EVENT_TYPE,
  EBootStep,
  EBootStepState,
  type BootStepEvent,
  type WireEvent,
} from '@dltech/atlas-wire/web'

import {
  bootViewOf,
  ETranscriptKind,
  isSendDelivered,
  threadTitleOf,
  transcriptOf,
  withPendingSend,
} from '../transcript'

const T0 = Date.parse('2026-10-21T10:00:00.000Z')
const isoAt = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

const wire = (args: { seq: number; type: string; body: unknown; offsetMs?: number }): WireEvent => ({
  id: `evt_${args.seq}`,
  threadId: 'thr_1',
  seq: args.seq,
  runId: 'run_1',
  depth: 0,
  at: isoAt(args.offsetMs ?? args.seq * 1000),
  type: args.type,
  body: JSON.stringify(args.body),
})

const said = (seq: number, text: string) => wire({ seq, type: 'user-said', body: { type: 'user-said', text } })
const answered = (seq: number, parts: unknown[]) =>
  wire({ seq, type: 'assistant-said', body: { type: 'assistant-said', parts } })
const boot = (seq: number, event: BootStepEvent) =>
  wire({ seq, type: BOOT_STEP_EVENT_TYPE, body: event })

describe('transcriptOf', () => {
  it('orders user and agent messages by seq and joins text parts', () => {
    const items = transcriptOf([
      answered(3, [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'there' },
      ]),
      said(1, 'hi'),
    ])
    expect(items.map((item) => [item.kind, item.text])).toEqual([
      [ETranscriptKind.User, 'hi'],
      [ETranscriptKind.Agent, 'Hello there'],
    ])
  })

  it('skips empty agent turns, unknown types and malformed bodies', () => {
    const items = transcriptOf([
      answered(1, [{ type: 'reasoning', text: 'only thoughts' }]),
      wire({ seq: 2, type: 'tool-called', body: { type: 'tool-called' } }),
      { ...said(3, 'x'), body: 'not json' },
      said(4, 'kept'),
    ])
    expect(items.map((item) => item.text)).toEqual(['kept'])
  })
})

describe('pending sends', () => {
  const pending = { sendId: 's1', text: 'build it' }

  it('appends an optimistic user message until a matching user-said arrives', () => {
    const items = transcriptOf([])
    const shown = withPendingSend({ items, pending })
    expect(shown).toHaveLength(1)
    expect(shown[0]?.kind).toBe(ETranscriptKind.User)
    expect(shown[0]?.text).toBe('build it')
  })

  it('drops the optimistic message once delivered', () => {
    const items = transcriptOf([said(1, 'build it ')])
    expect(isSendDelivered({ items, pending })).toBe(true)
    expect(withPendingSend({ items, pending })).toBe(items)
  })
})

describe('threadTitleOf', () => {
  it('collapses whitespace and caps at 60 characters', () => {
    expect(threadTitleOf('  fix\n the   bug ')).toBe('fix the bug')
    expect(threadTitleOf('x'.repeat(100))).toHaveLength(60)
  })
})

describe('bootViewOf', () => {
  it('is null without boot events', () => {
    expect(bootViewOf({ events: [said(1, 'hi')], now: T0 })).toBeNull()
  })

  it('reports running with elapsed time to now', () => {
    const view = bootViewOf({
      events: [
        boot(1, { step: EBootStep.Provision, state: EBootStepState.Running }),
        boot(2, { step: EBootStep.Provision, state: EBootStepState.Done }),
        boot(3, { step: EBootStep.Serve, state: EBootStepState.Running, detail: 'installing' }),
      ],
      now: T0 + 9000,
    })
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.elapsedMs).toBe(8000)
    expect(view?.steps.map((step) => step.state)).toEqual([
      EBootStepState.Done,
      EBootStepState.Running,
      EBootStepState.Pending,
      EBootStepState.Pending,
      EBootStepState.Pending,
      EBootStepState.Pending,
    ])
    expect(view?.steps[1]).toMatchObject({ label: 'Start Atlas', detail: 'installing' })
  })

  it('reports done with elapsed between first and last boot event', () => {
    const events = [EBootStep.Provision, EBootStep.Serve, EBootStep.Clone, EBootStep.Context, EBootStep.Settings, EBootStep.Agent].flatMap(
      (step, index) => [
        boot(index * 2 + 1, { step, state: EBootStepState.Running }),
        boot(index * 2 + 2, { step, state: EBootStepState.Done }),
      ],
    )
    const view = bootViewOf({ events, now: T0 + 999_000 })
    expect(view?.state).toBe(EBootStepState.Done)
    expect(view?.elapsedMs).toBe(11_000)
  })

  it('surfaces the provision error text and no elapsed time', () => {
    const view = bootViewOf({
      events: [
        boot(1, { step: EBootStep.Provision, state: EBootStepState.Running }),
        boot(2, { step: EBootStep.Provision, state: EBootStepState.Error, error: 'No Vercel credential' }),
      ],
      now: T0 + 5000,
    })
    expect(view?.state).toBe(EBootStepState.Error)
    expect(view?.error).toBe('No Vercel credential')
    expect(view?.steps[0]).toMatchObject({ state: EBootStepState.Error, detail: 'No Vercel credential' })
    expect(view?.elapsedMs).toBeUndefined()
  })

  it('shows only the latest boot attempt after a retry', () => {
    const view = bootViewOf({
      events: [
        boot(1, { step: EBootStep.Provision, state: EBootStepState.Running }),
        boot(2, { step: EBootStep.Provision, state: EBootStepState.Error, error: 'boom' }),
        boot(3, { step: EBootStep.Provision, state: EBootStepState.Running }),
      ],
      now: T0 + 4000,
    })
    expect(view?.state).toBe(EBootStepState.Running)
    expect(view?.error).toBeUndefined()
  })
})
