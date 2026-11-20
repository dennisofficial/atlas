import { describe, expect, it } from 'bun:test'

import {
  EAgentStatus,
  EMergeQueueMove,
  EPrEventKind,
  EReportKind,
  EShellStatus,
  toThreadId,
  type EventBody,
  type PendingInputsState,
} from '@dltech/atlas-core'

import { queuedNoticesOf, visibleQueuedOf } from '../queued-messages'

const noticeInput = (args: {
  inboxId: number
  seq?: number
  event: EventBody
}): PendingInputsState['pending'][number] => ({
  inboxId: args.inboxId,
  seq: args.seq ?? args.inboxId,
  at: '2026-11-18T10:00:00.000Z',
  kind: 'event',
  event: args.event,
})

const messageInput = (args: {
  inboxId: number
  seq?: number
  text: string
}): PendingInputsState['pending'][number] => ({
  inboxId: args.inboxId,
  seq: args.seq ?? args.inboxId,
  at: '2026-11-18T10:00:00.000Z',
  kind: 'message',
  message: { text: args.text, clientId: `client-${args.inboxId}` },
})

const shellEnded: EventBody = {
  type: 'background-shell-ended',
  shellId: 'shell-1',
  command: 'bun test',
  description: 'unit tests',
  status: EShellStatus.Exited,
  exitCode: 0,
  output: '',
  droppedCharacters: 0,
  remainingCharacters: 0,
}

const prEvent: EventBody = {
  type: 'pr-event',
  repo: 'github.com/o/r',
  prNumber: 1284,
  kind: EPrEventKind.MergeQueue,
  queue: EMergeQueueMove.Entered,
  url: 'https://github.com/o/r/pull/1284',
}

const agentReported: EventBody = {
  type: 'agent-reported',
  agentId: toThreadId('thread-a'),
  agentType: 'builder',
  intent: 'fix the flaky spec',
  prose: 'halfway there',
  kind: EReportKind.Progress,
}

describe('queuedNoticesOf', () => {
  it('lists one notice per pending event, keyed by its inboxId', () => {
    const pending: PendingInputsState = {
      pending: [
        noticeInput({ inboxId: 7, event: shellEnded }),
        noticeInput({ inboxId: 8, event: prEvent }),
      ],
    }

    expect(queuedNoticesOf(pending)).toEqual([
      { id: '7', text: 'Background shell "unit tests" completed (exit code 0)', failed: false },
      { id: '8', text: 'PR #1284: entered the merge queue', failed: false },
    ])
  })

  it('leaves the queued messages alone', () => {
    const pending: PendingInputsState = {
      pending: [
        messageInput({ inboxId: 1, text: 'first' }),
        noticeInput({ inboxId: 2, event: shellEnded }),
      ],
    }

    expect(visibleQueuedOf({ pending })).toEqual([{ id: '1', text: 'first', attachments: [] }])
  })

  it('keeps the message dock order when a notice sits between two messages', () => {
    const pending: PendingInputsState = {
      pending: [
        messageInput({ inboxId: 1, seq: 1, text: 'first' }),
        noticeInput({ inboxId: 2, seq: 2, event: shellEnded }),
        messageInput({ inboxId: 3, seq: 3, text: 'second' }),
      ],
    }

    expect(visibleQueuedOf({ pending }).map((entry) => entry.id)).toEqual(['1', '3'])
    expect(queuedNoticesOf(pending).map((notice) => notice.id)).toEqual(['2'])
  })

  it('drops an event with no one-line notice', () => {
    const pending: PendingInputsState = {
      pending: [
        noticeInput({
          inboxId: 4,
          event: {
            type: 'background-shell-started',
            shellId: 'shell-1',
            command: 'bun test',
          },
        }),
      ],
    }

    expect(queuedNoticesOf(pending)).toEqual([])
  })

  it('keeps a notice that needs attention', () => {
    const pending: PendingInputsState = {
      pending: [
        noticeInput({ inboxId: 9, event: { ...agentReported, kind: EReportKind.Blocked } }),
      ],
    }

    expect(queuedNoticesOf(pending)).toEqual([
      { id: '9', text: 'Sub-agent fix the flaky reported it is blocked', failed: true },
    ])
  })

  it('keeps a stopped agent with its ending line', () => {
    const pending: PendingInputsState = {
      pending: [
        noticeInput({
          inboxId: 10,
          event: {
            type: 'agent-ended',
            agentId: toThreadId('thread-a'),
            agentType: 'builder',
            intent: 'fix the flaky spec',
            status: EAgentStatus.Finished,
            prose: 'done',
            turns: 3,
            toolCalls: 9,
          },
        }),
      ],
    }

    expect(queuedNoticesOf(pending)).toEqual([
      {
        id: '10',
        text: 'Sub-agent fix the flaky finished after 3 turns and 9 tool calls',
        failed: false,
      },
    ])
  })
})
