import { describe, expect, it } from 'bun:test'
import { APICallError } from '@ai-sdk/provider'

import {
  defaultPipeline,
  EMPTY_PROMPT,
  ERunFailureKind,
  toRunId,
  type ModelPort,
} from '@dltech/atlas-core'

import { LoopTurnRunner } from '..'
import { ModelStreamError } from '../../model/errors'
import { ETurnStatus } from '../turn-outcome'
import { openSteerable } from './steerable-turn'

const unauthorized = (): ModelStreamError =>
  new ModelStreamError({
    message: 'InvalidApiKey',
    cause: new APICallError({
      message: 'InvalidApiKey',
      url: 'https://api.example.com/v1/chat',
      requestBodyValues: {},
      statusCode: 401,
      isRetryable: false,
    }),
  })

const turnFailedIn = async (args: Awaited<ReturnType<typeof openSteerable>>) =>
  (await args.harness.log.read({ threadId: args.threadId })).filter(
    (event) => event.type === 'run-failed',
  )

describe('a failed turn is persisted', () => {
  it('appends exactly one run-failed carrying the classified failure and model', async () => {
    const opened = await openSteerable({ script: [{ text: 'unused' }] })
    const failing: ModelPort = {
      identity: opened.harness.model.identity,
      step: async () => {
        throw unauthorized()
      },
    }
    const runner = new LoopTurnRunner({
      log: opened.harness.log,
      model: failing,
      ids: opened.harness.ids,
      assembly: defaultPipeline({
        prompt: () => EMPTY_PROMPT,
        launchDirectory: '/w',
      }),
      retry: {
        policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 },
        sleep: async () => {},
        jitter: () => 1,
      },
    })

    const outcome = await runner.say({ threadId: opened.threadId, text: 'hi' })

    expect(outcome.status).toBe(ETurnStatus.Failed)
    const failed = await turnFailedIn(opened)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      failure: {
        kind: ERunFailureKind.Auth,
        message: outcome.status === ETurnStatus.Failed ? outcome.message : '',
        modelId: opened.harness.model.identity.modelId,
        providerId: opened.harness.model.identity.id,
      },
    })
  })

  it('appends none for a turn that completes', async () => {
    const opened = await openSteerable({ script: [{ text: 'done' }] })

    const outcome = await opened.runner.say({
      threadId: opened.threadId,
      text: 'hi',
    })

    expect(outcome.status).toBe(ETurnStatus.Completed)
    expect(await turnFailedIn(opened)).toHaveLength(0)
  })

  it('appends none for an interrupted turn', async () => {
    const opened = await openSteerable({ script: [{ text: 'done' }] })
    const controller = new AbortController()
    controller.abort()

    const outcome = await opened.runner.say({
      threadId: opened.threadId,
      text: 'hi',
      signal: controller.signal,
    })

    expect(outcome.status).toBe(ETurnStatus.Interrupted)
    expect(await turnFailedIn(opened)).toHaveLength(0)
  })

  it('writes no turn-failed alongside the run-failed', async () => {
    const opened = await openSteerable({ script: [{ text: 'unused' }] })
    const failing: ModelPort = {
      identity: opened.harness.model.identity,
      step: async () => {
        throw unauthorized()
      },
    }
    const runner = new LoopTurnRunner({
      log: opened.harness.log,
      model: failing,
      ids: opened.harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
      retry: {
        policy: { maxAttempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
        sleep: async () => {},
        jitter: () => 1,
      },
    })
    await runner.say({ threadId: opened.threadId, text: 'hi' })
    const types = (await opened.harness.log.read({ threadId: opened.threadId })).map(
      (event) => event.type,
    )
    expect(types.filter((type) => type === 'run-failed' || type === 'turn-failed')).toEqual([
      'run-failed',
    ])
  })

  it('records a thrown turn once, under the run that threw, as crashed', async () => {
    const opened = await openSteerable({ script: [{ text: 'unused' }] })
    const log = opened.harness.log
    const brokenLog = {
      ...log,
      read: async (args: Parameters<typeof log.read>[0]) => {
        const events = await log.read(args)
        if (events.some((event) => event.type === 'user-said')) throw new Error('disk gone')
        return events
      },
      append: log.append.bind(log),
    }
    const runner = new LoopTurnRunner({
      log: brokenLog as typeof log,
      model: opened.harness.model,
      ids: opened.harness.ids,
      assembly: defaultPipeline({ prompt: () => EMPTY_PROMPT, launchDirectory: '/w' }),
    })
    await log.append({
      threadId: opened.threadId,
      runId: toRunId('seed'),
      drafts: [{ type: 'user-said', text: 'hi' }],
    })

    await expect(runner.runTurn({ threadId: opened.threadId })).rejects.toThrow('disk gone')

    const failed = await turnFailedIn(opened)
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({ failure: { kind: ERunFailureKind.Crashed } })
    expect(failed[0]?.runId).not.toBe(toRunId('seed'))
  })
})
