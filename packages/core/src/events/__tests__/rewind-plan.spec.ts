import { describe, expect, it } from 'bun:test'

import { EExecutionLocation } from '../../execution/location'
import { EServiceStatus } from '../../services/status'
import { EShellStatus } from '../../shells/status'
import type { EventDraft } from '../body'
import type { Event } from '../envelope'
import { toThreadId, toCallId, toEventId, toRunId } from '../ids'
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
const replied = (text: string): EventDraft => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})
const startedInBackground = (callId: string): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(callId),
  name: 'bash',
  input: { command: 'npm test', runInBackground: true },
  ordinal: 0,
})
const backgrounded = (callId: string, shellId: string): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name: 'bash',
  output: { shellId, status: 'running' },
})
const startedService = (callId: string): EventDraft => ({
  type: 'tool-called',
  callId: toCallId(callId),
  name: 'service_start',
  input: { command: 'npm run dev', description: 'dev server' },
  ordinal: 0,
})
const serviceRunning = (callId: string, serviceId: string): EventDraft => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name: 'service_start',
  output: { serviceId, status: 'running' },
})
const shellEnded = (shellId: string, output: string): EventDraft => ({
  type: 'background-shell-ended',
  shellId,
  command: 'npm test',
  status: EShellStatus.Exited,
  exitCode: 0,
  output,
  droppedCharacters: 0,
  remainingCharacters: 0,
})
const serviceEnded = (serviceId: string): EventDraft => ({
  type: 'service-ended',
  serviceId,
  command: 'npm run dev',
  description: 'dev server',
  status: EServiceStatus.Exited,
  exitCode: 0,
  logPath: '/tmp/svc.log',
  tail: 'shutting down',
})

const cutIds = (plan: ReturnType<typeof rewindPlan>, kind: 'shell' | 'service'): string[] =>
  plan.cuts.flatMap((cut) => {
    if (cut.kind === 'shell' && kind === 'shell') return [cut.shellId]
    if (cut.kind === 'service' && kind === 'service') return [cut.serviceId]
    return []
  })

const transcript = (): Event[] =>
  eventsFrom([
    said('msg_1'),
    startedInBackground('call-1'),
    backgrounded('call-1', 'bash_1'),
    replied('on it'),
    said('msg_2'),
    shellEnded('bash_1', 'all green'),
    said('msg_3'),
  ])

describe('rewindPlan for background shells', () => {
  it('keeps a notice that landed above the cut when its shell started below it', () => {
    const plan = rewindPlan({ events: transcript(), toSeq: 5 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend).toHaveLength(1)
    expect(plan.reappend[0]?.draft).toEqual({
      type: 'background-shell-ended',
      shellId: 'bash_1',
      command: 'npm test',
      status: EShellStatus.Exited,
      exitCode: 0,
      output: 'all green',
      droppedCharacters: 0,
      remainingCharacters: 0,
    })
  })

  it('cuts a shell whose background start the cut removes, dropping every notice of it', () => {
    const plan = rewindPlan({ events: transcript(), toSeq: 1 })

    expect(cutIds(plan, 'shell')).toEqual(['bash_1'])
    expect(plan.reappend).toEqual([])
  })

  it('carries the start details on the cut so the confirmation can name the shell', () => {
    const plan = rewindPlan({ events: transcript(), toSeq: 1 })

    expect(plan.cuts[0]).toMatchObject({ kind: 'shell', shellId: 'bash_1', command: 'npm test' })
  })

  it('carries the notice runId so the re-append can keep provenance', () => {
    const plan = rewindPlan({ events: transcript(), toSeq: 5 })

    expect(plan.reappend[0]?.runId).toBe(toRunId('run-1'))
  })

  it('never keeps ordinary events from above the cut, only notices with a surviving source', () => {
    const plan = rewindPlan({ events: transcript(), toSeq: 5 })

    expect(plan.reappend).toHaveLength(1)
    expect(plan.reappend[0]?.draft.type).toBe('background-shell-ended')
  })

  it('keeps a shell whose start the log no longer holds, the way summarisation leaves it', () => {
    const events = eventsFrom([said('msg_1'), shellEnded('bash_7', 'from a compacted era')])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend).toHaveLength(1)
  })

  it('does not read a shell_output call above the cut as the shell being started there', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedInBackground('call-1'),
      backgrounded('call-1', 'bash_1'),
      said('msg_2'),
      {
        type: 'tool-called',
        callId: toCallId('call-2'),
        name: 'shell_output',
        input: { shellId: 'bash_1' },
        ordinal: 0,
      },
      {
        type: 'tool-result',
        callId: toCallId('call-2'),
        name: 'shell_output',
        output: { shellId: 'bash_1', status: 'running', text: 'a line' },
      },
      shellEnded('bash_1', 'all green'),
    ])

    const plan = rewindPlan({ events, toSeq: 4 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend).toHaveLength(1)
  })

  it('cuts only the shell whose start is above the cut when two shells straddle it', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedInBackground('call-1'),
      backgrounded('call-1', 'bash_1'),
      said('msg_2'),
      startedInBackground('call-2'),
      backgrounded('call-2', 'bash_2'),
      shellEnded('bash_1', 'all green'),
      shellEnded('bash_2', 'also green'),
    ])

    const plan = rewindPlan({ events, toSeq: 4 })

    expect(cutIds(plan, 'shell')).toEqual(['bash_2'])
    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      expect.objectContaining({ shellId: 'bash_1' }),
    ])
  })
})

describe('rewindPlan for services', () => {
  it('cuts a service whose service_start the cut removes, dropping its ending', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedService('call-1'),
      serviceRunning('call-1', 'svc_1'),
      said('msg_2'),
      serviceEnded('svc_1'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(plan.cuts).toEqual([
      {
        kind: 'service',
        seq: 3,
        serviceId: 'svc_1',
        command: 'npm run dev',
        description: 'dev server',
      },
    ])
    expect(plan.reappend).toEqual([])
  })

  it('keeps the ending of a service that started below the cut', () => {
    const events = eventsFrom([
      said('msg_1'),
      startedService('call-1'),
      serviceRunning('call-1', 'svc_1'),
      said('msg_2'),
      serviceEnded('svc_1'),
    ])

    const plan = rewindPlan({ events, toSeq: 4 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      expect.objectContaining({ type: 'service-ended', serviceId: 'svc_1' }),
    ])
  })

  it('keeps a service whose start the log no longer holds', () => {
    const events = eventsFrom([said('msg_1'), serviceEnded('svc_9')])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend).toHaveLength(1)
  })
})

describe('rewindPlan for location changes', () => {
  it('keeps a location-changed above the cut, since the move is still true', () => {
    const events = eventsFrom([
      said('msg_1'),
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
      said('msg_2'),
      replied('on it'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(plan.cuts).toEqual([])
    expect(plan.reappend).toHaveLength(1)
    expect(plan.reappend[0]?.draft).toEqual({
      type: 'location-changed',
      from: EExecutionLocation.Host,
      to: EExecutionLocation.Cloud,
    })
  })

  it('keeps every move when the log holds several', () => {
    const events = eventsFrom([
      said('msg_1'),
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
      said('msg_2'),
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
      said('msg_3'),
    ])

    const plan = rewindPlan({ events, toSeq: 1 })

    expect(plan.reappend.map((notice) => notice.draft)).toEqual([
      { type: 'location-changed', from: EExecutionLocation.Host, to: EExecutionLocation.Cloud },
      { type: 'location-changed', from: EExecutionLocation.Cloud, to: EExecutionLocation.Host },
    ])
  })
})
