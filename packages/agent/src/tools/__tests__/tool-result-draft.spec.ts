import { describe, expect, it } from 'bun:test'

import { EToolEffect, toCallId, toThreadId, type ToolCall } from '@dltech/atlas-core'

import { resultDraft } from '../tool-result-draft'

const call: ToolCall = {
  callId: toCallId('call-1'),
  name: 'bash',
  input: {},
  effect: EToolEffect.Destructive,
  threadId: toThreadId('thread-1'),
}

describe('resultDraft', () => {
  it('keeps the span detail a tool reported out of the result the model sees', () => {
    const draft = resultDraft({
      call,
      result: {
        ok: true,
        output: { exitCode: 2 },
        modelText: 'Exit code: 2',
        spanDetail: { 'exec.outcome': 'exit', 'exec.exitCode': 2 },
      },
      interrupted: false,
    })

    expect(draft).toEqual({
      type: 'tool-result',
      callId: toCallId('call-1'),
      name: 'bash',
      output: { exitCode: 2 },
      modelText: 'Exit code: 2',
    })
  })

  it('keeps it out of a failed result too', () => {
    const draft = resultDraft({
      call,
      result: {
        ok: false,
        reason: 'the command could not be run',
        spanDetail: { 'exec.outcome': 'exit' },
      },
      interrupted: false,
    })

    expect(draft).toEqual({
      type: 'tool-result',
      callId: toCallId('call-1'),
      name: 'bash',
      output: undefined,
      error: { message: 'the command could not be run' },
    })
  })
})
