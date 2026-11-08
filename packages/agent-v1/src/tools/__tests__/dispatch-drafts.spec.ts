import { describe, expect, it } from 'bun:test'

import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'

import { invalidInputDraft } from '../dispatch-drafts'

const call = {
  callId: toCallId('call-1'),
  name: 'bash',
  input: { description: 'Check current CI state for the PR' },
  runId: toRunId('run-1'),
  threadId: toThreadId('thread-1'),
}

const missingCommand = [
  { path: ['command'], message: 'Invalid input: expected string, received undefined' },
]

describe('invalidInputDraft', () => {
  it('names the rejected field, what the tool takes, and that the call has to be made again', () => {
    const draft = invalidInputDraft({
      call,
      issues: missingCommand,
      parameters: { required: ['command'], optional: ['description', 'workdir'] },
    })

    expect(draft).toMatchObject({
      type: 'tool-result',
      error: {
        message:
          'the bash tool rejected this input: command: Invalid input: expected string, received undefined. Nothing ran. bash takes command as required, and also accepts description, workdir. Call bash again with the required fields set.',
      },
    })
  })

  it('still asks for another call when the schema names no parameters', () => {
    const draft = invalidInputDraft({
      call: { ...call, name: 'read' },
      issues: missingCommand,
      parameters: { required: [], optional: [] },
    })

    expect(draft).toMatchObject({
      type: 'tool-result',
      error: {
        message:
          'the read tool rejected this input: command: Invalid input: expected string, received undefined. Nothing ran. Call read again with the required fields set.',
      },
    })
  })

  it('says the input does not match when the schema reports no field at all', () => {
    const draft = invalidInputDraft({
      call,
      issues: [],
      parameters: { required: ['command'], optional: [] },
    })

    expect(draft).toMatchObject({
      type: 'tool-result',
      error: {
        message:
          'the bash tool rejected this input: it does not match the schema. Nothing ran. bash takes command as required and nothing else. Call bash again with the required fields set.',
      },
    })
  })
})
