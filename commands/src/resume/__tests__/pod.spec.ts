import { describe, expect, it } from 'bun:test'
import type { CommandContext } from '@dltech/atlas-commands'
import {
  chainEvents,
  EResumeOutcome,
  EResumePoint,
  ETurnCause,
  ETurnEndedBy,
  ETurnOutcome,
  RESUME_REFUSAL_ALREADY,
  RESUME_REFUSAL_FINISHED,
  RESUME_REFUSAL_RUNNING,
  toCallId,
  toRunId,
  toThreadId,
  type EventDraft,
  type PluginEventBody,
  type RecordBody,
  type RecordEventBody,
  type RecordEvent,
} from '@dltech/atlas-core'

import { REFUSAL_RESUME_AGENT, resumeHandler } from '../pod'

const threadId = toThreadId('thread-1')
const runId = toRunId('run-1')
const at = '2026-01-01T00:00:00.000Z'

const eventsOf = (bodies: readonly RecordEventBody[]): RecordEvent[] =>
  chainEvents({ threadId, runId, epoch: 1, at, bodies })

const said = (text: string): RecordEventBody => ({ type: 'user-said', text })

const replied = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
})

const cutReply = (text: string): RecordEventBody => ({
  type: 'assistant-said',
  parts: [{ type: 'text', text }],
  interrupted: true,
  stopped: true,
})

const started = (turnId = 'turn-1'): RecordEventBody => ({
  type: 'turn-started',
  turnId,
  cause: ETurnCause.Input,
})

const ended = (outcome: ETurnOutcome, turnId = 'turn-1'): RecordEventBody => ({
  type: 'turn-ended',
  turnId,
  outcome,
  by: ETurnEndedBy.Operator,
})

const called = (callId: string): RecordEventBody => ({
  type: 'tool-called',
  callId: toCallId(callId),
  name: 'bash',
  input: {},
  ordinal: 0,
})

const interruptedResult = (callId: string): RecordEventBody => ({
  type: 'tool-result',
  callId: toCallId(callId),
  name: 'bash',
  output: 'killed with the turn',
  interrupted: true,
})

const marker: RecordEventBody = {
  type: 'resume-marked',
  point: EResumePoint.Clean,
  discards: [{ fromSeq: 3, throughSeq: 3 }],
  callIds: [],
  inboxId: 7,
}

const stoppedText = [
  said('run the suite'),
  started(),
  cutReply('half a sentence'),
  ended(ETurnOutcome.Stopped),
]

const stoppedTool = [
  said('run the suite'),
  started(),
  cutReply('half a sentence'),
  called('c1'),
  interruptedResult('c1'),
  ended(ETurnOutcome.Stopped),
]

const run = async (params: {
  bodies: readonly RecordEventBody[]
  args?: unknown
  mainThreadId?: string | undefined
  crew?: { resume(args: { agentId: string }): Promise<EResumeOutcome> } | undefined
}) => {
  const appended: (EventDraft | RecordBody | PluginEventBody)[] = []
  const context: CommandContext<unknown> = {
    args: params.args ?? {},
    sessionId: 's1',
    inboxId: 7,
    visibleEvents: () => [],
    logEvents: () => eventsOf(params.bodies),
    runningChildren: () => 0,
    ...(params.mainThreadId === undefined ? {} : { mainThreadId: params.mainThreadId }),
    ...(params.crew === undefined ? {} : { crew: params.crew }),
    append: async (drafts) => {
      appended.push(...drafts)
    },
    log: () => undefined,
  }
  const result = await resumeHandler(context)
  return { appended, result }
}

describe('resumeHandler', () => {
  it('appends one marker that discards the cut reply', async () => {
    const { appended, result } = await run({ bodies: stoppedText })

    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([
      {
        type: 'resume-marked',
        point: EResumePoint.Clean,
        discards: [{ fromSeq: 3, throughSeq: 3 }],
        callIds: [],
        inboxId: 7,
      },
    ])
  })

  it('names the interrupted calls of a cut tool step', async () => {
    const { appended, result } = await run({ bodies: stoppedTool })

    expect(result).toEqual({ kind: 'done' })
    expect(appended).toEqual([
      {
        type: 'resume-marked',
        point: EResumePoint.ToolInterrupted,
        discards: [],
        callIds: ['c1'],
        inboxId: 7,
      },
    ])
  })

  it('refuses a finished turn with the point sentence and appends nothing', async () => {
    const { appended, result } = await run({
      bodies: [said('run the suite'), started(), replied('done'), ended(ETurnOutcome.Completed)],
    })

    expect(result).toEqual({ kind: 'refused', reason: RESUME_REFUSAL_FINISHED })
    expect(appended).toEqual([])
  })

  it('refuses a second resume', async () => {
    const { appended, result } = await run({ bodies: [...stoppedText, marker] })

    expect(result).toEqual({ kind: 'refused', reason: RESUME_REFUSAL_ALREADY })
    expect(appended).toEqual([])
  })

  it('refuses while a turn runs', async () => {
    const { appended, result } = await run({ bodies: [said('run the suite'), started()] })

    expect(result).toEqual({ kind: 'refused', reason: RESUME_REFUSAL_RUNNING })
    expect(appended).toEqual([])
  })

  it('resumes the main thread when the agent id names it', async () => {
    const calls: string[] = []
    const crew = {
      resume: async (args: { agentId: string }) => {
        calls.push(args.agentId)
        return EResumeOutcome.Resumed
      },
    }

    const { appended, result } = await run({
      bodies: stoppedText,
      args: { agentId: 'thread-1' },
      mainThreadId: 'thread-1',
      crew,
    })

    expect(result).toEqual({ kind: 'done' })
    expect(calls).toEqual([])
    expect(appended).toHaveLength(1)
  })

  it('hands a named sub-agent to the crew', async () => {
    const calls: string[] = []
    const crew = {
      resume: async (args: { agentId: string }) => {
        calls.push(args.agentId)
        return EResumeOutcome.Resumed
      },
    }

    const { appended, result } = await run({
      bodies: stoppedText,
      args: { agentId: 'child-1' },
      mainThreadId: 'thread-1',
      crew,
    })

    expect(result).toEqual({ kind: 'done' })
    expect(calls).toEqual(['child-1'])
    expect(appended).toEqual([])
  })

  it('refuses a sub-agent this session does not have', async () => {
    const { result } = await run({ bodies: stoppedText, args: { agentId: 'child-1' } })

    expect(result).toEqual({ kind: 'refused', reason: REFUSAL_RESUME_AGENT })
  })

  it('refuses a running sub-agent', async () => {
    const crew = { resume: async () => EResumeOutcome.Running }

    const { result } = await run({
      bodies: stoppedText,
      args: { agentId: 'child-1' },
      mainThreadId: 'thread-1',
      crew,
    })

    expect(result).toEqual({ kind: 'refused', reason: RESUME_REFUSAL_RUNNING })
  })
})
