import { describe, expect, it } from 'bun:test'

import { answerOperatorRequest, type OperatorAnswerBody } from '../operator-answer'

const apiCapturing = (failure?: unknown) => {
  const bodies: OperatorAnswerBody[] = []
  return {
    bodies,
    api: {
      operatorRequests: {
        answer: {
          mutate: async (body: OperatorAnswerBody) => {
            bodies.push(body)
            if (failure !== undefined) throw failure
          },
        },
      },
    },
  }
}

describe('answerOperatorRequest', () => {
  it('posts the session, the call and the value', async () => {
    const { api, bodies } = apiCapturing()

    const result = await answerOperatorRequest({
      api,
      body: { sessionId: 'ses_1', callId: 'call_1', value: 'hunter2' },
    })

    expect(result).toEqual({ ok: true })
    expect(bodies).toEqual([{ sessionId: 'ses_1', callId: 'call_1', value: 'hunter2' }])
  })

  it('posts the cancel flag when the operator declines', async () => {
    const { api, bodies } = apiCapturing()

    await answerOperatorRequest({
      api,
      body: { sessionId: 'ses_1', callId: 'call_1', cancel: true },
    })

    expect(bodies).toEqual([{ sessionId: 'ses_1', callId: 'call_1', cancel: true }])
  })

  it('says the host could not be reached when the failure carried no status', async () => {
    const { api } = apiCapturing(new Error('offline'))

    const result = await answerOperatorRequest({
      api,
      body: { sessionId: 'ses_1', callId: 'call_1', value: 'hunter2' },
    })

    expect(result).toEqual({ ok: false, reason: 'the agent host could not be reached' })
  })
})
