import { describe, expect, it } from 'bun:test'

import {
  EStage,
  EToolEffect,
  toCallId,
  toThreadId,
  type HookOutcome,
  type ToolCall,
} from '@dltech/atlas-core'

import { EHookMishapKind, type HookMishap } from '../budget'
import { HookChain, type AfterToolHook } from '../registry'

const call: ToolCall = {
  callId: toCallId('call-1'),
  name: 'write',
  input: {},
  effect: EToolEffect.Write,
  threadId: toThreadId('thread-1'),
}

const observe = async (): Promise<HookOutcome> => ({})

const hook = (args: {
  name: string
  capturesFileChanges?: (args: { call: ToolCall; signal: AbortSignal }) => Promise<boolean>
}): AfterToolHook => ({
  name: args.name,
  order: { stage: EStage.Observe, nudge: 0 },
  run: observe,
  ...(args.capturesFileChanges === undefined
    ? {}
    : { capturesFileChanges: args.capturesFileChanges }),
})

const chainOver = (args: {
  hooks: readonly AfterToolHook[]
  mishaps?: HookMishap[]
  budgetMs?: number
}): HookChain =>
  new HookChain({
    afterTool: args.hooks,
    ...(args.budgetMs === undefined ? {} : { budgetMs: args.budgetMs }),
    ...(args.mishaps === undefined
      ? {}
      : { onMishap: (mishap: HookMishap) => args.mishaps?.push(mishap) }),
  })

const signal = new AbortController().signal

describe('a hook chain asked whether to capture file changes', () => {
  it('says no when no hook opts in', async () => {
    expect(await chainOver({ hooks: [] }).capturesFileChanges({ call, signal })).toBe(false)
    expect(
      await chainOver({ hooks: [hook({ name: 'quiet' })] }).capturesFileChanges({ call, signal }),
    ).toBe(false)
  })

  it('says yes when one hook opts in for the call it was asked about', async () => {
    const chain = chainOver({
      hooks: [
        hook({
          name: 'reviewer',
          capturesFileChanges: async ({ call: asked }) => asked.name === 'write',
        }),
      ],
    })

    expect(await chain.capturesFileChanges({ call, signal })).toBe(true)
    expect(await chain.capturesFileChanges({ call: { ...call, name: 'read' }, signal })).toBe(false)
  })

  it('asks every opting hook at once rather than one after the other', async () => {
    const pending: (() => void)[] = []
    const slow = hook({
      name: 'slow',
      capturesFileChanges: () =>
        new Promise<boolean>((resolve) => {
          pending.push(() => resolve(true))
        }),
    })
    const chain = chainOver({ hooks: [slow, { ...slow, name: 'slower' }] })

    const asked = chain.capturesFileChanges({ call, signal })
    expect(pending).toHaveLength(2)
    for (const release of pending) release()

    expect(await asked).toBe(true)
  })

  it('treats a predicate that throws as no opt-in and reports the mishap under the hook name', async () => {
    const mishaps: HookMishap[] = []
    const chain = chainOver({
      hooks: [
        hook({
          name: 'reviewer',
          capturesFileChanges: async () => {
            throw new Error('no registry')
          },
        }),
      ],
      mishaps,
    })

    expect(await chain.capturesFileChanges({ call, signal })).toBe(false)
    expect(mishaps).toEqual([
      { label: 'reviewer', kind: EHookMishapKind.Threw, detail: 'no registry' },
    ])
  })

  it('treats a predicate that outruns its budget as no opt-in and reports the overrun', async () => {
    const mishaps: HookMishap[] = []
    const chain = chainOver({
      hooks: [hook({ name: 'reviewer', capturesFileChanges: () => new Promise(() => {}) })],
      mishaps,
      budgetMs: 5,
    })

    expect(await chain.capturesFileChanges({ call, signal })).toBe(false)
    expect(mishaps).toEqual([
      { label: 'reviewer', kind: EHookMishapKind.Overran, detail: 'exceeded 5ms' },
    ])
  })

  it('keeps the predicate on the afterTool hook it was handed', () => {
    const predicate = async (): Promise<boolean> => true
    const chain = chainOver({
      hooks: [{ ...hook({ name: 'reviewer' }), capturesFileChanges: predicate }],
    })

    expect(chain.afterTool[0]?.capturesFileChanges).toBe(predicate)
  })
})
