import { describe, expect, it } from 'bun:test'
import fc from 'fast-check'

import { ECompactionAnchor } from '../../events/body'
import { toCallId } from '../../events/ids'
import { assemble } from '../../assembly/assemble'
import { contextFor } from '../../assembly/__tests__/log-fixture'
import { exchangeFaults } from '../../assembly/exchange-shape'
import { defaultRules } from '../../assembly/pipeline'
import { EMPTY_PROMPT } from '../../assembly/rules/system-prompt'
import { chainHash } from '../chain'
import { chainEvents } from '../chain-events'
import type { V2Body, V2Event } from '../event'
import { visibleLoopEvents } from '../loop-events'
import { EMPTY_VISIBILITY, isVisible, stepVisibility } from '../visibility'
import { NOW, runId, threadId } from './support'

type Op =
  | { kind: 'user' }
  | { kind: 'said' }
  | { kind: 'call'; id: number }
  | { kind: 'result'; id: number }
  | { kind: 'loaded' }
  | { kind: 'rewind'; pick: number }
  | { kind: 'summarise'; a: number; b: number }

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Op>({ kind: 'user' }) },
  { weight: 3, arbitrary: fc.constant<Op>({ kind: 'said' }) },
  { weight: 3, arbitrary: fc.nat(3).map((id): Op => ({ kind: 'call', id })) },
  { weight: 3, arbitrary: fc.nat(3).map((id): Op => ({ kind: 'result', id })) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'loaded' }) },
  { weight: 1, arbitrary: fc.nat(1000).map((pick): Op => ({ kind: 'rewind', pick })) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.nat(1000), fc.nat(1000))
      .map(([a, b]): Op => ({ kind: 'summarise', a, b })),
  },
)

const bodyFor = (params: { op: Op; nextSeq: number; targets: readonly number[] }): V2Body => {
  const { op, nextSeq, targets } = params
  if (op.kind === 'user' || nextSeq < 2) return { type: 'user-said', text: `u${nextSeq}` }
  if (op.kind === 'said') return { type: 'assistant-said', parts: [{ type: 'text', text: 'a' }] }
  if (op.kind === 'call') {
    const callId = toCallId(`call-${op.id}`)
    return { type: 'tool-called', callId, name: 'read', input: { seq: nextSeq }, ordinal: 0 }
  }
  if (op.kind === 'result') {
    const callId = toCallId(`call-${op.id}`)
    return { type: 'tool-result', callId, name: 'read', output: 'r', modelText: 'r' }
  }
  if (op.kind === 'loaded') {
    return { type: 'context-loaded', slot: 'project', key: `k${nextSeq}`, content: 'rules' }
  }
  if (op.kind === 'rewind') {
    return { type: 'history-rewound', toSeq: targets[op.pick % targets.length] ?? 0 }
  }
  const first = (op.a % (nextSeq - 1)) + 1
  const second = (op.b % (nextSeq - 1)) + 1
  return {
    type: 'history-summarised',
    fromSeq: Math.min(first, second),
    throughSeq: Math.max(first, second),
    anchor: ECompactionAnchor.Prefix,
    summary: `s${nextSeq}`,
  }
}

const buildLog = (ops: readonly Op[]): V2Event[] => {
  const built: V2Event[] = []
  let state = EMPTY_VISIBILITY
  const bodies = [...ops, { kind: 'user' } as const]
  bodies.forEach((op, index) => {
    const nextSeq = index + 1
    const visible = built.filter((event) => isVisible(state, event)).map((event) => event.seq)
    const last = built.at(-1)
    const [event] = chainEvents({
      threadId,
      runId,
      epoch: 1,
      at: NOW,
      from: last === undefined ? undefined : { seq: last.seq, hash: chainHash(last) },
      bodies: [bodyFor({ op, nextSeq, targets: [0, ...visible] })],
    })
    if (event === undefined) return
    built.push(event)
    state = stepVisibility(state, event)
  })
  return built
}

const logArb = fc.array(opArb, { minLength: 1, maxLength: 40 }).map(buildLog)

const faultsOf = (args: { log: readonly V2Event[]; windowStart: number }) => {
  const events = visibleLoopEvents(args.log)
  const assembled = assemble({
    rules: defaultRules({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
    ctx: contextFor({ events: events.slice(args.windowStart % Math.max(events.length, 1)) }),
  }).assembled
  return exchangeFaults(assembled).map((fault) => `${fault.fault} @${fault.messageIndex}`)
}

describe('assembly over any v2 log', () => {
  it('sends a well-formed exchange after any appends, rewinds, summaries and window cut', () => {
    fc.assert(
      fc.property(logArb, fc.nat(60), (log, windowStart) => {
        expect(faultsOf({ log, windowStart })).toEqual([])
      }),
      { numRuns: 3000 },
    )
  })
})
