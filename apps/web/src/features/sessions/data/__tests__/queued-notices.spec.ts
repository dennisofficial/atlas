import { describe, expect, it } from 'bun:test'

import {
  EShellStatus,
  toThreadId,
  type EventBody,
  type PendingInputsState,
} from '@dltech/atlas-core'

import { visibleQueuedOf } from '../queued-messages'

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

describe('visibleQueuedOf', () => {
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
  })

  it('drops an agent report that carries no message', () => {
    const pending: PendingInputsState = {
      pending: [
        noticeInput({
          inboxId: 9,
          event: {
            type: 'agent-reported',
            agentId: toThreadId('thread-a'),
            agentType: 'builder',
            intent: 'fix the flaky spec',
            prose: 'halfway there',
          },
        }),
      ],
    }

    expect(visibleQueuedOf({ pending })).toEqual([])
  })
})
