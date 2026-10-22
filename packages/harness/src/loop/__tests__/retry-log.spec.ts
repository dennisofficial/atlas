import { describe, expect, it } from 'bun:test'

import { APICallError } from '@ai-sdk/provider'

import {
  defaultPipeline,
  ELogSeverity,
  EMPTY_PROMPT,
  LogPort,
  type LogEntry,
  type ModelPort,
  type RetryPolicy,
} from '@dltech/atlas-core'

import { LoopTurnRunner } from '..'
import { ModelStreamError } from '../../model/errors'
import { openSteerable } from './steerable-turn'

class CapturingLog extends LogPort {
  readonly entries: LogEntry[] = []
  record(entry: LogEntry): void {
    this.entries.push(entry)
  }
}

const POLICY: RetryPolicy = { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }

const upstreamFailure = (): ModelStreamError =>
  new ModelStreamError({
    message: 'stream failed',
    cause: new APICallError({
      message: 'The upstream provider returned an error while processing this request.',
      url: 'https://user:hunter2@api.example.com/v1/chat?key=sk-url-secret',
      requestBodyValues: { prompt: 'prompt-secret' },
      responseHeaders: { Authorization: 'Bearer sk-header-secret' },
      responseBody: '{"error":{"message":"body-secret","code":"upstream_error"}}',
      statusCode: 400,
      isRetryable: false,
      data: {
        error: {
          message: 'body-secret',
          type: 'server_error',
          code: 'upstream_error',
        },
      },
    }),
  })

async function runFailingTurn(): Promise<LogEntry[]> {
  const opened = await openSteerable({ script: [{ text: 'recovered' }] })
  const log = new CapturingLog()
  const failing: ModelPort = {
    identity: opened.harness.model.identity,
    step: async () => {
      throw upstreamFailure()
    },
  }
  const runner = new LoopTurnRunner({
    log: opened.harness.log,
    logPort: log,
    model: failing,
    ids: opened.harness.ids,
    assembly: defaultPipeline({
      prompt: () => EMPTY_PROMPT,
      launchDirectory: '/w',
    }),
    retry: { policy: POLICY, sleep: async () => {}, jitter: () => 1 },
  })

  await runner.say({ threadId: opened.threadId, text: 'do X' })
  return log.entries.filter((entry) => entry.source === 'loop.retry')
}

describe('the retry log for a failed model step', () => {
  it('records the failure metadata the classifier saw, on the first of five attempts', async () => {
    const [first] = await runFailingTurn()

    expect(first?.severity).toBe(ELogSeverity.Warn)
    expect(first?.data).toMatchObject({
      attempt: 1,
      maxAttempts: 5,
      modelError: {
        statusCode: 400,
        isRetryable: false,
        providerCode: 'upstream_error',
        providerType: 'server_error',
      },
    })
  })

  it('never persists the request, headers, url, or response body', async () => {
    const serialized = JSON.stringify(await runFailingTurn())

    for (const secret of ['hunter2', 'sk-url-secret', 'sk-header-secret', 'prompt-secret', 'body-secret']) {
      expect(serialized).not.toContain(secret)
    }
  })

  it('still logs the error message and stack', async () => {
    const [first] = await runFailingTurn()

    expect(first?.error).toContain('The upstream provider returned an error')
    expect(first?.stack).toBeDefined()
  })
})
