import { describe, expect, it } from 'bun:test'
import { APICallError } from '@ai-sdk/provider'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  EAgentStatus,
  type EventDraft,
  type EventLogPort,
  type ModelPort,
  type RetryPolicy,
} from '@dltech/atlas-core'

import { ETurnStatus, LoopTurnRunner } from '..'
import type { PendingDrain } from '../run-turn'
import { openSteerable, userTexts, type Opened } from './steerable-turn'

const FAIL_FAST: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }
const FAIL_ONCE: RetryPolicy = { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 1 }

const overloaded = (): APICallError =>
  new APICallError({
    message: 'overloaded',
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: {},
    statusCode: 529,
  })

const quietTeammateEnded: EventDraft = {
  type: 'agent-ended',
  agentId: 'brn_quiet' as never,
  agentType: 'teammate',
  intent: 'a peer that already reported',
  status: EAgentStatus.Finished,
  prose: 'work is done',
  turns: 3,
  toolCalls: 9,
}

const typesOf = (events: readonly { type: string }[]): string[] => events.map((event) => event.type)

async function harnessLog(harness: { log: EventLogPort }, threadId: Parameters<EventLogPort['read']>[0]['threadId']) {
  return harness.log.read({ threadId })
}

function openFailingOnce(opened: Opened, args: {
  failAppend?: number
  actOnFirstStep?: () => void
}) {
  const { harness, queue } = opened

  let steps = 0
  const flakyModel: ModelPort = {
    identity: harness.model.identity,
    step: async (stepArgs) => {
      steps += 1
      if (steps === 1) {
        args.actOnFirstStep?.()
        throw overloaded()
      }
      return harness.model.step(stepArgs)
    },
  }

  let acknowledged = 0
  let released = 0
  const ackingDrain = async (): Promise<PendingDrain> => {
    const drained = await queue.drain()
    return {
      ...drained,
      acknowledge: () => {
        acknowledged += 1
      },
      release: () => {
        released += 1
      },
    }
  }

  let appends = 0
  const originalAppend = harness.log.append.bind(harness.log)
  const flakyLog = Object.create(harness.log) as EventLogPort
  flakyLog.append = async (appendArgs) => {
    appends += 1
    if (args.failAppend !== undefined && appends === args.failAppend) throw new Error('log is wedged')
    return originalAppend(appendArgs)
  }

  return { flakyModel, flakyLog, ackingDrain, acks: () => acknowledged, releases: () => released, steps: () => steps }
}

function openTurn(args: {
  script: Parameters<typeof openSteerable>[0]['script']
  failAppend?: number
  actOnFirstStep?: () => void
  actOnSleep?: () => void
  policy?: RetryPolicy
}) {
  return openSteerable({ script: args.script }).then((opened) => {
    const { flakyModel, flakyLog, ackingDrain, acks, releases, steps } = openFailingOnce(opened, args)

    const runner = new LoopTurnRunner({
      log: flakyLog,
      model: flakyModel,
      ids: opened.harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      drainPending: ackingDrain,
      retry: {
        policy: args.policy ?? FAIL_FAST,
        sleep: async () => args.actOnSleep?.(),
        jitter: () => 1,
      },
    })

    return { runner, harness: opened.harness, model: opened.model, queue: opened.queue, threadId: opened.threadId, acks, releases, steps }
  })
}

describe('a retry that runs after input arrived while the first request was failing', () => {
  it('reassembles the prompt so the second request answers what arrived during the first', async () => {
    const { runner, harness, model, queue, threadId } = await openTurn({
      script: [{ text: 'working on X' }, { text: 'on to Y' }],
      actOnFirstStep: () => queue.type('actually, do Y'),
    })

    const outcome = await runner.say({ threadId, text: 'do X' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(1)
    expect(userTexts(model.doStreamCalls[0]?.prompt ?? [])).toContain('actually, do Y')
  })

  it('acknowledges the drained batch once it is durable, not before', async () => {
    const { runner, harness, queue, threadId, acks } = await openTurn({
      script: [{ text: 'working on X' }, { text: 'on to Y' }],
      actOnFirstStep: () => queue.type('actually, do Y'),
    })

    await runner.say({ threadId, text: 'do X' })

    expect(queue.drains()).toBeGreaterThan(1)
    expect(acks()).toBeGreaterThan(0)
    const events = await harnessLog(harness, threadId)
    expect(events.filter((event) => event.type === 'user-said' && event.text === 'actually, do Y')).toHaveLength(1)
  })

  it('releases the intake lease when the log refuses the drain append, so nothing is acknowledged or lost', async () => {
    const { runner, harness, model, queue, threadId, acks, releases } = await openTurn({
      script: [{ text: 'working on X' }, { text: 'on to Y' }],
      actOnFirstStep: () => queue.type('actually, do Y'),
      failAppend: 2,
    })

    const outcome = await runner.say({ threadId, text: 'do X' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(model.doStreamCalls).toHaveLength(0)
    expect(acks()).toBe(1)
    expect(releases()).toBe(1)
    const events = await harnessLog(harness, threadId)
    expect(events.filter((event) => event.type === 'user-said' && event.text === 'actually, do Y')).toHaveLength(0)
  })

  it('releases the intake lease when the log refuses the retry-time append, acknowledging nothing', async () => {
    const { runner, harness, model, queue, threadId, acks, releases } = await openTurn({
      script: [{ text: 'working on X' }, { text: 'on to Y' }],
      actOnFirstStep: () => queue.type('actually, do Y'),
      failAppend: 2,
      policy: FAIL_ONCE,
    })

    const outcome = await runner.say({ threadId, text: 'do X' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    expect(model.doStreamCalls).toHaveLength(0)
    expect(acks()).toBe(1)
    expect(releases()).toBe(1)
    const events = await harnessLog(harness, threadId)
    expect(events.filter((event) => event.type === 'user-said' && event.text === 'actually, do Y')).toHaveLength(0)
  })

  it('keeps the drained batch acknowledged when the log refuses the assistant append after a retry succeeds', async () => {
    const { runner, harness, model, queue, threadId, acks, releases } = await openTurn({
      script: [{ text: 'working on X' }, { text: 'on to Y' }],
      actOnFirstStep: () => queue.type('actually, do Y'),
      failAppend: 3,
    })

    await expect(runner.say({ threadId, text: 'do X' })).rejects.toThrow('log is wedged')

    expect(model.doStreamCalls).toHaveLength(1)
    expect(acks()).toBe(2)
    expect(releases()).toBe(0)
    const events = await harnessLog(harness, threadId)
    expect(events.filter((event) => event.type === 'user-said' && event.text === 'actually, do Y')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'assistant-said')).toHaveLength(0)
  })
})

describe('input that lands while a retry is backing off', () => {
  it('is drained after the sleep and answered by the request that follows it', async () => {
    const { runner, harness, model, queue, threadId } = await openTurn({
      script: [{ text: 'working on X' }, { text: 'on to Y' }],
      actOnSleep: () => queue.type('actually, do Y'),
    })

    const outcome = await runner.say({ threadId, text: 'do X' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(model.doStreamCalls).toHaveLength(1)
    expect(userTexts(model.doStreamCalls[0]?.prompt ?? [])).toContain('actually, do Y')
    const events = await harnessLog(harness, threadId)
    expect(events.filter((event) => event.type === 'user-said' && event.text === 'actually, do Y')).toHaveLength(1)
  })
})

describe('an interrupt that lands while a retry is waiting to re-ask', () => {
  it('ends the turn interrupted with the typed message durable and never sent', async () => {
    const opened = await openSteerable({ script: [{ text: 'working on X' }] })
    const { harness, queue, threadId } = opened
    const controller = new AbortController()

    let steps = 0
    const flakyModel: ModelPort = {
      identity: harness.model.identity,
      step: async (stepArgs) => {
        steps += 1
        if (steps === 1) throw overloaded()
        return harness.model.step(stepArgs)
      },
    }

    const runner = new LoopTurnRunner({
      log: harness.log,
      model: flakyModel,
      ids: harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      drainPending: queue.drain,
      retry: {
        policy: FAIL_FAST,
        sleep: async () => {
          queue.type('actually, do Y')
          controller.abort()
        },
        jitter: () => 1,
      },
    })

    await expect(runner.say({ threadId, text: 'do X', signal: controller.signal })).rejects.toThrow('overloaded')

    expect(steps).toBe(1)
    expect(opened.model.doStreamCalls).toHaveLength(0)
    const events = await harnessLog(harness, threadId)
    expect(typesOf(events)).toEqual(['user-said'])
  })
})

describe('a quiet teammate ending drained while the model request was failing', () => {
  it('lands in the log before the assistant answer without prompting a second model step', async () => {
    const { runner, harness, model, queue, threadId, steps } = await openTurn({
      script: [{ text: 'working on X' }],
      actOnFirstStep: () => queue.queue(quietTeammateEnded),
    })

    const outcome = await runner.say({ threadId, text: 'do X' })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(steps()).toBe(2)
    expect(model.doStreamCalls).toHaveLength(1)
    const events = await harnessLog(harness, threadId)
    expect(typesOf(events)).toEqual(['user-said', 'agent-ended', 'assistant-said'])
    expect(userTexts(model.doStreamCalls[0]?.prompt ?? [])).not.toContain('work is done')
  })

  it('does not answer the ending again on the next loop iteration', async () => {
    const { runner, harness, model, queue, threadId, steps } = await openTurn({
      script: [{ text: 'working on X' }],
      actOnFirstStep: () => queue.queue(quietTeammateEnded),
    })

    await runner.say({ threadId, text: 'do X' })
    const after = await runner.runTurn({ threadId })

    expect(after.status).toBe(ETurnStatus.Idle)
    expect(steps()).toBe(2)
    expect(model.doStreamCalls).toHaveLength(1)
  })
})
