import { describe, expect, it } from 'bun:test'

import { toCallId, toRunId, toThreadId } from '@dltech/atlas-core'

import { invalidInputDraft, markDispatchStarted } from '../dispatch-drafts'

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

describe('the dispatch marker when the append fails', () => {
  const sandboxDown =
    'sandbox for s-1 is unavailable: wake failed: its daemon did not answer on port 3000 within 30s. Nothing ran. The sandbox is offline, so retrying tool calls will not help: stop making sandbox tool calls, tell the operator the sandbox is down and why, and end your turn.'

  const failingAppend = (error: Error) => async (): Promise<void> => {
    throw error
  }

  it('hands an unavailable sandbox to the model as it stands, without blaming the marker', async () => {
    const unavailable = new Error(sandboxDown)
    unavailable.name = 'SandboxUnavailableError'

    const failure = await markDispatchStarted({
      onDispatchStarted: failingAppend(unavailable),
      call,
      logPort: undefined,
    })

    expect(failure).toBe(sandboxDown)
    expect(failure).not.toContain('did not persist')
  })

  it('still names the marker when the append fails for any other reason', async () => {
    const failure = await markDispatchStarted({
      onDispatchStarted: failingAppend(new Error('disk full')),
      call,
      logPort: undefined,
    })

    expect(failure).toBe(
      'the dispatch marker for bash did not persist, so the call was not run: disk full',
    )
  })
})
