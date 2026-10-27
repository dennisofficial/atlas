import { describe, expect, it } from 'bun:test'

import { EClientRequest } from '@dltech/atlas-client/channel'

import { submitOperatorInput, UNDELIVERED_NOTICE } from '../operator-input-submit'
import { NOT_CONNECTED_NOTICE } from '../queued-edit'

const channelReplying = (reply: () => Promise<unknown>) => {
  const sent: { op: EClientRequest; params: unknown }[] = []
  return {
    sent,
    channel: {
      request: (args: { op: EClientRequest; params: unknown }) => {
        sent.push(args)
        return reply()
      },
    },
  }
}

describe('submitOperatorInput', () => {
  it('provides the value for the request and reports no notice when delivered', async () => {
    const { channel, sent } = channelReplying(async () => ({ delivered: true, bytes: 4 }))
    expect(await submitOperatorInput({ channel, requestId: 'opin_1', value: 'abcd' })).toBeNull()
    expect(sent).toEqual([
      {
        op: EClientRequest.ProvideOperatorInput,
        params: { requestId: 'opin_1', value: 'abcd' },
      },
    ])
  })

  it('keeps the value byte for byte', async () => {
    const { channel, sent } = channelReplying(async () => ({ delivered: true, bytes: 6 }))
    await submitOperatorInput({ channel, requestId: 'opin_1', value: ' a\nb \n' })
    expect(sent[0]?.params).toEqual({ requestId: 'opin_1', value: ' a\nb \n' })
  })

  it('says so when the sandbox did not take it', async () => {
    const { channel } = channelReplying(async () => ({ delivered: false, bytes: 0 }))
    expect(await submitOperatorInput({ channel, requestId: 'opin_1', value: 'x' })).toBe(
      UNDELIVERED_NOTICE,
    )
  })

  it('surfaces a refusal from serve', async () => {
    const { channel } = channelReplying(async () => {
      throw new Error('that request is no longer waiting')
    })
    expect(await submitOperatorInput({ channel, requestId: 'opin_1', value: 'x' })).toBe(
      'that request is no longer waiting',
    )
  })

  it('refuses without a channel', async () => {
    expect(await submitOperatorInput({ channel: null, requestId: 'opin_1', value: 'x' })).toBe(
      NOT_CONNECTED_NOTICE,
    )
  })
})
