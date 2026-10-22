import { describe, expect, it } from 'bun:test'

import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toCallId, toEventId, toRunId, toThreadId } from '../ids'
import { rewindPlan } from '../rewind-plan'
import { stampDrafts } from '../stamp'

const eventsFrom = (drafts: readonly EventDraft[]): Event[] =>
  stampDrafts({
    drafts,
    envelopes: drafts.map((_, index) => ({
      id: toEventId(`evt-${index + 1}`),
      seq: index + 1,
      threadId: toThreadId('thread-1'),
      runId: toRunId('run-1'),
      depth: 0,
      at: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
    })),
  })

const said = (text: string): EventDraft => ({ type: 'user-said', text })
const called = (callId: string, name: string, input: unknown): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(callId),
  name,
  input,
  ordinal: 0,
})
const returned = (callId: string, name: string, output: unknown): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name,
  output,
})
const launched = (callId: string): EventDraft =>
  called(callId, 'bash', { command: 'npm test', runInBackground: true })
const backgrounded = (callId: string, shellId: string): EventDraft =>
  returned(callId, 'bash', { shellId, status: 'running' })
const shellStarted = (shellId: string, bootId?: string): EventDraft => ({
  type: 'background-shell-started',
  shellId,
  command: 'npm test',
  bootId,
})
const shellEnded = (shellId: string, output: string, bootId?: string): EventDraft => ({
  type: 'background-shell-ended',
  shellId,
  command: 'npm test',
  bootId,
  status: EShellStatus.Exited,
  exitCode: 0,
  output,
  droppedCharacters: 0,
  remainingCharacters: 0,
})

const cutSeqs = (plan: ReturnType<typeof rewindPlan>): number[] => plan.cuts.map((cut) => cut.seq)
const keptOutputs = (plan: ReturnType<typeof rewindPlan>): unknown[] =>
  plan.reappend.map((notice) => ('output' in notice.draft ? notice.draft.output : undefined))

describe('rewindPlan shell occurrence identity', () => {
  it('cuts only the boot whose start sits above the cut when two boots reuse the same shell id', () => {
    const events = eventsFrom([
      said('msg_1'),
      shellStarted('bash_1', 'boot-a'),
      said('msg_2'),
      shellStarted('bash_1', 'boot-b'),
      shellEnded('bash_1', 'boot a done', 'boot-a'),
      shellEnded('bash_1', 'boot b done', 'boot-b'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(cutSeqs(plan)).toEqual([4])
    expect(keptOutputs(plan)).toEqual(['boot a done'])
  })

  it('keeps both boots endings when the cut sits above both starts', () => {
    const events = eventsFrom([
      shellStarted('bash_1', 'boot-a'),
      shellStarted('bash_1', 'boot-b'),
      said('msg_1'),
      shellEnded('bash_1', 'boot b done', 'boot-b'),
      shellEnded('bash_1', 'boot a done', 'boot-a'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(plan.cuts).toEqual([])
    expect(keptOutputs(plan)).toEqual(['boot b done', 'boot a done'])
  })

  it('cuts both boots and drops both endings when the cut sits below both starts', () => {
    const events = eventsFrom([
      said('msg_1'),
      shellStarted('bash_1', 'boot-a'),
      shellStarted('bash_1', 'boot-b'),
      shellEnded('bash_1', 'boot a done', 'boot-a'),
      shellEnded('bash_1', 'boot b done', 'boot-b'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(cutSeqs(plan)).toEqual([2, 3])
    expect(plan.reappend).toEqual([])
  })

  it('keeps an earlier boot ending that lands after the later boot start', () => {
    const events = eventsFrom([
      said('msg_1'),
      shellStarted('bash_1', 'boot-a'),
      said('msg_2'),
      shellStarted('bash_1', 'boot-b'),
      shellEnded('bash_1', 'boot a done', 'boot-a'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(cutSeqs(plan)).toEqual([4])
    expect(keptOutputs(plan)).toEqual(['boot a done'])
  })

  it('treats sequential legacy starts of one shell id without boot ids as separate occurrences', () => {
    const events = eventsFrom([
      said('msg_1'),
      launched('call-1'),
      backgrounded('call-1', 'bash_1'),
      shellEnded('bash_1', 'first done'),
      launched('call-2'),
      backgrounded('call-2', 'bash_1'),
      shellEnded('bash_1', 'second done'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(cutSeqs(plan)).toEqual([6])
    expect(keptOutputs(plan)).toEqual(['first done'])
  })

  it('cuts both legacy occurrences of a reused shell id when the cut sits below both', () => {
    const events = eventsFrom([
      said('msg_1'),
      launched('call-1'),
      backgrounded('call-1', 'bash_1'),
      shellEnded('bash_1', 'first done'),
      launched('call-2'),
      backgrounded('call-2', 'bash_1'),
      shellEnded('bash_1', 'second done'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(cutSeqs(plan)).toEqual([3, 6])
    expect(plan.reappend).toEqual([])
  })

  it('does not cut by the tool result when a modern start sits below the cut and the result above it', () => {
    const events = eventsFrom([
      said('msg_1'),
      launched('call-1'),
      shellStarted('bash_1', 'boot-a'),
      said('msg_2'),
      backgrounded('call-1', 'bash_1'),
      shellEnded('bash_1', 'all green', 'boot-a'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(plan.cuts).toEqual([])
    expect(keptOutputs(plan)).toEqual(['all green'])
  })

  it('falls back to the tool pairing for a legacy launch when a later boot recorded the same id', () => {
    const events = eventsFrom([
      said('msg_1'),
      launched('call-1'),
      backgrounded('call-1', 'bash_1'),
      shellEnded('bash_1', 'legacy done'),
      said('msg_2'),
      launched('call-2'),
      shellStarted('bash_1', 'boot-b'),
      backgrounded('call-2', 'bash_1'),
      shellEnded('bash_1', 'modern done', 'boot-b'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(cutSeqs(plan)).toEqual([3, 7])
    expect(plan.reappend).toEqual([])
  })

  it('cuts once when the tool pairing and the started event describe the same launch', () => {
    const events = eventsFrom([
      said('msg_1'),
      launched('call-1'),
      shellStarted('bash_1', 'boot-a'),
      backgrounded('call-1', 'bash_1'),
      shellEnded('bash_1', 'all green', 'boot-a'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(cutSeqs(plan)).toEqual([3])
    expect(plan.reappend).toEqual([])
  })

  it('never reads a shell_output call as a shell creation', () => {
    const events = eventsFrom([
      said('msg_1'),
      shellStarted('bash_1', 'boot-a'),
      said('msg_2'),
      called('call-2', 'shell_output', { shellId: 'bash_1', runInBackground: true }),
      returned('call-2', 'shell_output', { shellId: 'bash_1', status: 'running' }),
      shellEnded('bash_1', 'all green', 'boot-a'),
    ])

    const plan = rewindPlan({ events, toSeq: 3 })

    expect(plan.cuts).toEqual([])
    expect(keptOutputs(plan)).toEqual(['all green'])
  })
})
