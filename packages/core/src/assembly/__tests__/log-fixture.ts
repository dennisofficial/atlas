import { expect } from 'bun:test'

import type { EventDraft } from '../../events/body'
import type { Event, EventEnvelope } from '../../events/envelope'
import { toThreadId, toEventId, toRunId } from '../../events/ids'
import { stampDrafts } from '../../events/stamp'
import type { RuleContext } from '../rule'
import { estimateTokens } from '../tokens'

export const fixtureThreadId = toThreadId('thread-fixture')

const fixtureRunId = toRunId('run-fixture')

const envelopeAt = (index: number): EventEnvelope => ({
  id: toEventId(`event-${index + 1}`),
  seq: index + 1,
  threadId: fixtureThreadId,
  runId: fixtureRunId,
  depth: 0,
  at: '2026-01-01T00:00:00.000Z',
})

export function log(drafts: readonly EventDraft[]): Event[] {
  return stampDrafts({ drafts, envelopes: drafts.map((_draft, index) => envelopeAt(index)) })
}

export function contextFor({
  events,
  step = 0,
  previous,
}: {
  events: readonly Event[]
  step?: number
  previous?: RuleContext['previous']
}): RuleContext {
  return {
    events,
    threadId: fixtureThreadId,
    step,
    provider: { id: 'fixture', modelId: 'fixture-model' },
    countTokens: estimateTokens,
    ...(previous === undefined ? {} : { previous }),
  }
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const envelopedAs = ({ tag, body }: { tag: string; body: string }): string =>
  expect.stringMatching(new RegExp(`^<${tag}( [a-z-]+="[^"]*")*>\\n${escapeRegExp(body)}\\n</${tag}>$`))

export const operatorSaidAs = (text: string): string => envelopedAs({ tag: 'operator-said', body: text })
