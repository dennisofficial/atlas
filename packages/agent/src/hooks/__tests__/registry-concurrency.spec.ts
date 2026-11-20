import { describe, expect, it } from 'bun:test'

import {
  EStage,
  toThreadId,
  type BeforeTurn,
  type EventDraft,
  type HookOrder,
  type HookOutcome,
} from '@dltech/atlas-core'
import { ESpan } from '@dltech/atlas-observability'
import { RecordingTracer } from '@dltech/atlas-observability/testing'

import { EHookMishapKind } from '../budget'
import { EHookPhase, HookChain, type RegisteredHook } from '../registry'

const THREAD = toThreadId('thread-1')
const TURN = { threadId: THREAD, projectDirectory: '/repo' }

const observe = (nudge: number): HookOrder => ({ stage: EStage.Observe, nudge })
const guard = (nudge: number): HookOrder => ({ stage: EStage.Guard, nudge })

const gate = (): { opened: Promise<void>; open: () => void } => {
  let open = (): void => {}
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return { opened, open }
}

const contextOf = (drafts: readonly EventDraft[]): readonly string[] =>
  drafts.flatMap((draft) => (draft.type === 'context-loaded' ? [draft.content] : []))

const said = (text: string): HookOutcome => ({ additionalContext: text })

const hook = (args: {
  name: string
  order: HookOrder
  run: BeforeTurn
}): RegisteredHook<BeforeTurn> => args

describe('beforeTurn hooks in one stage run together', () => {
  it('starts every hook of a stage before any of them settles', async () => {
    const started: string[] = []
    const release = gate()
    const waiting = (name: string): RegisteredHook<BeforeTurn> =>
      hook({
        name,
        order: observe(0),
        run: async () => {
          started.push(name)
          await release.opened
          return said(name)
        },
      })
    const chain = new HookChain({ beforeTurn: [waiting('a'), waiting('b'), waiting('c')] })

    const turn = chain.beforeTurn(TURN)
    await Promise.resolve()
    await Promise.resolve()
    expect(started).toEqual(['a', 'b', 'c'])
    release.open()

    expect(contextOf(await turn)).toEqual(['a', 'b', 'c'])
  })

  it('costs the slowest hook, not the sum of them', async () => {
    const slow = (name: string): RegisteredHook<BeforeTurn> =>
      hook({
        name,
        order: observe(0),
        run: async () => {
          await Bun.sleep(60)
          return said(name)
        },
      })
    const chain = new HookChain({ beforeTurn: [slow('a'), slow('b'), slow('c'), slow('d')] })

    const startedAt = performance.now()
    await chain.beforeTurn(TURN)

    expect(performance.now() - startedAt).toBeLessThan(200)
  })

  it('keeps the drafts in hook order whatever order they settle in', async () => {
    const after = (ms: number, name: string, nudge: number): RegisteredHook<BeforeTurn> =>
      hook({
        name,
        order: observe(nudge),
        run: async () => {
          await Bun.sleep(ms)
          return said(name)
        },
      })
    const chain = new HookChain({
      beforeTurn: [after(30, 'first', 1), after(1, 'second', 2), after(15, 'third', 3)],
    })

    expect(contextOf(await chain.beforeTurn(TURN))).toEqual(['first', 'second', 'third'])
  })

  it('finishes an earlier stage before a later one starts', async () => {
    const seen: string[] = []
    const chain = new HookChain({
      beforeTurn: [
        hook({
          name: 'observer',
          order: observe(0),
          run: async () => {
            seen.push('observer')
            return {}
          },
        }),
        hook({
          name: 'guard',
          order: guard(0),
          run: async () => {
            await Bun.sleep(20)
            seen.push('guard')
            return {}
          },
        }),
      ],
    })

    await chain.beforeTurn(TURN)

    expect(seen).toEqual(['guard', 'observer'])
  })
})

describe('each hook gets its own span', () => {
  const traced = async (
    hooks: readonly RegisteredHook<BeforeTurn>[],
    budgetMs?: number,
  ): Promise<RecordingTracer> => {
    const trace = new RecordingTracer()
    const chain = new HookChain({ beforeTurn: hooks, trace, budgetMs })
    await trace.span({
      name: ESpan.TurnHooks,
      root: true,
      run: () => chain.beforeTurn(TURN),
    })
    return trace
  }

  it('nests a span per hook under the turn, named by hook and phase', async () => {
    const trace = await traced([
      hook({ name: 'skills-catalogue', order: observe(0), run: async () => ({}) }),
      hook({ name: 'mcp-connect', order: observe(10), run: async () => ({}) }),
    ])

    const spans = trace.named(ESpan.Hook)
    expect(spans.map((span) => span.fields)).toEqual([
      { hook: 'skills-catalogue', phase: EHookPhase.BeforeTurn },
      { hook: 'mcp-connect', phase: EHookPhase.BeforeTurn },
    ])
    expect(spans.every((span) => span.parent?.name === ESpan.TurnHooks)).toBe(true)
  })

  it('marks the span of a hook that overran its budget', async () => {
    const trace = await traced(
      [hook({ name: 'hanger', order: observe(0), run: () => new Promise(() => {}) })],
      20,
    )

    expect(trace.named(ESpan.Hook)[0]?.fields.failureKind).toBe(EHookMishapKind.Overran)
  })

  it('runs untraced when the chain has no tracer', async () => {
    const chain = new HookChain({
      beforeTurn: [hook({ name: 'plain', order: observe(0), run: async () => said('plain') })],
    })

    expect(contextOf(await chain.beforeTurn(TURN))).toEqual(['plain'])
  })
})
