import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EMergeQueueMove,
  EPrEventKind,
  EPrVerdict,
  EReportKind,
  EServiceStatus,
  EShellStatus,
  toThreadId,
  type EventBody,
  type EventDraft,
} from '@dltech/atlas-core'

import { queuedNoticeLineOf } from '../queued-notice-line'
import { log } from './fixture'

const bodyOf = (draft: EventDraft): EventBody => {
  const [event] = log([draft])
  if (event === undefined) throw new Error('the fixture built no event')
  return event
}

const agentReported = (kind: EReportKind): EventBody =>
  bodyOf({
    type: 'agent-reported',
    agentId: toThreadId('thread-a'),
    agentType: 'builder',
    intent: 'fix the flaky spec',
    prose: 'halfway there',
    kind,
  })

describe('a queued agent report', () => {
  it('says what the sub-agent reported', () => {
    expect(queuedNoticeLineOf(agentReported(EReportKind.Done))).toEqual({
      text: 'Sub-agent fix the flaky reported done',
      failed: false,
    })
  })

  it('tints a report that needs a decision', () => {
    expect(queuedNoticeLineOf(agentReported(EReportKind.NeedsDecision))).toEqual({
      text: 'Sub-agent fix the flaky needs a decision',
      failed: true,
    })
  })
})

describe('a queued agent ending', () => {
  const ended = (over: Partial<Extract<EventBody, { type: 'agent-ended' }>>): EventBody =>
    bodyOf({
      type: 'agent-ended',
      agentId: toThreadId('thread-a'),
      agentType: 'builder',
      intent: 'fix the flaky spec',
      status: EAgentStatus.Finished,
      prose: 'done',
      turns: 3,
      toolCalls: 9,
      ...over,
    })

  it('says how the sub-agent ended', () => {
    expect(queuedNoticeLineOf(ended({}))).toEqual({
      text: 'Sub-agent fix the flaky finished after 3 turns and 9 tool calls',
      failed: false,
    })
  })

  it('tints a failure', () => {
    expect(queuedNoticeLineOf(ended({ status: EAgentStatus.Failed }))?.failed).toBe(true)
  })

  it('drops a bookkeeping ending that never wakes the parent', () => {
    expect(queuedNoticeLineOf(ended({ relayed: false }))).toBeUndefined()
  })
})

describe('a queued shell ending', () => {
  const shellEnded = (over: Partial<Extract<EventBody, { type: 'background-shell-ended' }>>) =>
    bodyOf({
      type: 'background-shell-ended',
      shellId: 'shell-1',
      command: 'bun test',
      description: 'unit tests',
      status: EShellStatus.Exited,
      exitCode: 0,
      output: '',
      droppedCharacters: 0,
      remainingCharacters: 0,
      ...over,
    })

  it('names the shell and its outcome', () => {
    expect(queuedNoticeLineOf(shellEnded({}))).toEqual({
      text: 'Background shell "unit tests" completed (exit code 0)',
      failed: false,
    })
  })

  it('tints a non-zero exit', () => {
    expect(queuedNoticeLineOf(shellEnded({ exitCode: 1 }))).toEqual({
      text: 'Background shell "unit tests" failed (exit code 1)',
      failed: true,
    })
  })
})

describe('a queued service ending', () => {
  const serviceEnded = (over: Partial<Extract<EventBody, { type: 'service-ended' }>>) =>
    bodyOf({
      type: 'service-ended',
      serviceId: 'dev',
      command: 'bun dev',
      description: 'the dev server',
      status: EServiceStatus.Exited,
      exitCode: 0,
      tail: '',
      ...over,
    })

  it('names the service and its outcome', () => {
    expect(queuedNoticeLineOf(serviceEnded({}))).toEqual({
      text: 'Service dev "the dev server" exited cleanly',
      failed: false,
    })
  })

  it('drops a service that is already restarting', () => {
    expect(queuedNoticeLineOf(serviceEnded({ restarting: true }))).toBeUndefined()
  })
})

describe('a queued pull request event', () => {
  it('names the pull request and what happened', () => {
    const body = bodyOf({
      type: 'pr-event',
      repo: 'github.com/o/r',
      prNumber: 1284,
      kind: EPrEventKind.MergeQueue,
      queue: EMergeQueueMove.Entered,
      url: 'https://github.com/o/r/pull/1284',
    })

    expect(queuedNoticeLineOf(body)).toEqual({
      text: 'PR #1284: entered the merge queue',
      failed: false,
    })
  })

  it('tints a failed verdict', () => {
    const body = bodyOf({
      type: 'pr-event',
      repo: 'github.com/o/r',
      prNumber: 1284,
      kind: EPrEventKind.Verdict,
      verdict: EPrVerdict.Failed,
      settled: true,
      failedChecks: [{ name: 'typecheck' }],
      url: 'https://github.com/o/r/pull/1284',
    })

    expect(queuedNoticeLineOf(body)?.failed).toBe(true)
  })
})

describe('a queued run event', () => {
  it('names the workflow, the run and its conclusion', () => {
    const body = bodyOf({
      type: 'run-event',
      repo: 'github.com/o/r',
      workflowRunId: 4411,
      workflow: 'ci',
      branch: 'main',
      url: 'https://github.com/o/r/actions/runs/4411',
      status: 'completed',
      conclusion: 'success',
    })

    expect(queuedNoticeLineOf(body)).toEqual({ text: 'ci #4411 success', failed: false })
  })
})

describe('a queued sandbox setup report', () => {
  it('reuses the setup text and its tone', () => {
    const body = bodyOf({
      type: 'sandbox-setup-reported',
      text: 'Cloud setup failed: boom',
      failed: true,
    })

    expect(queuedNoticeLineOf(body)).toEqual({ text: 'Cloud setup failed: boom', failed: true })
  })
})

describe('an event with no one-line notice', () => {
  it('renders nothing', () => {
    const body = bodyOf({
      type: 'background-shell-started',
      shellId: 'shell-1',
      command: 'bun test',
    })

    expect(queuedNoticeLineOf(body)).toBeUndefined()
  })
})
