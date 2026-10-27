import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'
import { EPendingEdit } from '@dltech/atlas-wire/web'

import { TOO_LATE_NOTICE } from '../composer-queue'
import {
  NOT_CONNECTED_NOTICE,
  NOT_EDITABLE_NOTICE,
  queuedEditNoticeOf,
  removeQueuedEntry,
  RESERVED_NOTICE,
  saveQueuedEntry,
} from '../queued-edit'

const channelReplying = (outcome: EPendingEdit) => {
  const sent: { op: EClientRequest; params: unknown }[] = []
  return {
    sent,
    channel: {
      request: async (args: { op: EClientRequest; params: unknown }) => {
        sent.push(args)
        return { outcome }
      },
    },
  }
}

describe('queuedEditNoticeOf', () => {
  it('is silent when the edit landed and explains every refusal', () => {
    expect(queuedEditNoticeOf(EPendingEdit.Done)).toBeNull()
    expect(queuedEditNoticeOf(EPendingEdit.Missing)).toBe(TOO_LATE_NOTICE)
    expect(queuedEditNoticeOf(EPendingEdit.Reserved)).toBe(RESERVED_NOTICE)
    expect(queuedEditNoticeOf(EPendingEdit.NotEditable)).toBe(NOT_EDITABLE_NOTICE)
  })
})

describe('saveQueuedEntry', () => {
  it('sends the new text over the channel', async () => {
    const { channel, sent } = channelReplying(EPendingEdit.Done)
    const notice = await saveQueuedEntry({ channel, threadId: 'thr_1', id: 'p1', text: 'later' })
    expect(notice).toBeNull()
    expect(sent).toEqual([
      {
        op: EClientRequest.UpdatePending,
        params: { threadId: 'thr_1', id: 'p1', text: 'later' },
      },
    ])
  })

  it('turns a refusal into its notice', async () => {
    const { channel } = channelReplying(EPendingEdit.Reserved)
    const notice = await saveQueuedEntry({ channel, threadId: 'thr_1', id: 'p1', text: 'x' })
    expect(notice).toBe(RESERVED_NOTICE)
  })

  it('says the sandbox is not connected without a channel', async () => {
    const notice = await saveQueuedEntry({ channel: null, threadId: 'thr_1', id: 'p1', text: 'x' })
    expect(notice).toBe(NOT_CONNECTED_NOTICE)
  })
})

describe('removeQueuedEntry', () => {
  it('removes over the channel', async () => {
    const { channel, sent } = channelReplying(EPendingEdit.Done)
    expect(await removeQueuedEntry({ channel, threadId: 'thr_1', id: 'p1' })).toBeNull()
    expect(sent).toEqual([
      { op: EClientRequest.RemovePending, params: { threadId: 'thr_1', id: 'p1' } },
    ])
  })

  it('reports a message that already left the queue', async () => {
    const { channel } = channelReplying(EPendingEdit.Missing)
    expect(await removeQueuedEntry({ channel, threadId: 'thr_1', id: 'p1' })).toBe(TOO_LATE_NOTICE)
  })

  it('reports a message that is not the operator’s', async () => {
    const { channel } = channelReplying(EPendingEdit.NotEditable)
    expect(await removeQueuedEntry({ channel, threadId: 'thr_1', id: 'p1' })).toBe(
      NOT_EDITABLE_NOTICE,
    )
  })
})
