import { describe, expect, it } from 'bun:test'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { DEFAULT_RETRY_POLICY, ERetryReason, toEventId, type Assembled } from '@dltech/atlas-core'

import { AiSdkModelPort } from '../../model/ai-sdk-model-port'
import { takeModelStepWithRetry, type RetryNotice } from '../retrying-step'

const UPSTREAM_MESSAGE = 'The upstream provider returned an error while processing this request.'
const ASSEMBLED: Assembled = {
  system: [],
  messages: [
    {
      message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      origin: { eventId: toEventId('evt-upstream'), seq: 1 },
    },
  ],
}

function replyStream(): Response {
  const chunks = [
    {
      id: 'reply',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'kimi-k3-fast',
      choices: [{ index: 0, delta: { content: 'recovered' }, finish_reason: null }],
    },
    {
      id: 'reply',
      object: 'chat.completion.chunk',
      created: 0,
      model: 'kimi-k3-fast',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    },
  ]
  return new Response(`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

function httpHarness(args: { status: number; message: string; failures: number; code?: string }) {
  let requests = 0
  const notices: RetryNotice[] = []
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => {
      requests += 1
      if (requests > args.failures) return replyStream()
      return Response.json({ error: { message: args.message, code: args.code } }, { status: args.status })
    },
  })
  const provider = createOpenAICompatible({
    name: 'local-upstream',
    baseURL: `${server.url}v1`,
  })
  const model = new AiSdkModelPort({
    model: provider.chatModel('kimi-k3-fast'),
  })
  const run = () =>
    takeModelStepWithRetry({
      model,
      tools: [],
      onChunk: undefined,
      assembled: ASSEMBLED,
      signal: new AbortController().signal,
      retry: {
        sleep: async () => {},
        jitter: () => 1,
        onWaiting: (notice) => notices.push(notice),
      },
    })
  return {
    run,
    notices,
    requests: () => requests,
    stop: () => server.stop(true),
  }
}

describe('retrying upstream failures through HTTP and the installed SDK', () => {
  it('recovers from the incident message returned as HTTP 400 with the SDK retryable flag false', async () => {
    const harness = httpHarness({
      status: 400,
      message: UPSTREAM_MESSAGE,
      failures: 1,
    })
    try {
      const result = await harness.run()
      expect(result.ok).toBe(true)
      expect(harness.requests()).toBe(2)
      expect(harness.notices).toEqual([
        {
          attempt: 1,
          maxAttempts: 5,
          delayMs: 1_000,
          reason: ERetryReason.ServerError,
        },
      ])
    } finally {
      harness.stop()
    }
  })

  it('stops a repeated upstream error at the existing five-attempt budget', async () => {
    const harness = httpHarness({
      status: 400,
      message: UPSTREAM_MESSAGE,
      failures: 10,
    })
    try {
      const result = await harness.run()
      expect(result.ok).toBe(false)
      expect(harness.requests()).toBe(DEFAULT_RETRY_POLICY.maxAttempts)
      expect(harness.notices.map((notice) => notice.delayMs)).toEqual([1_000, 2_000, 4_000, 8_000])
    } finally {
      harness.stop()
    }
  })

  it.each([401, 402, 403])('does not retry HTTP %i even with the upstream error message', async (status) => {
    const harness = httpHarness({
      status,
      message: UPSTREAM_MESSAGE,
      failures: 10,
    })
    try {
      const result = await harness.run()
      expect(result.ok).toBe(false)
      expect(harness.requests()).toBe(1)
      expect(harness.notices).toEqual([])
    } finally {
      harness.stop()
    }
  })

  it('does not retry a genuine HTTP 400 invalid request', async () => {
    const harness = httpHarness({
      status: 400,
      message: 'messages is required',
      code: 'invalid_request_error',
      failures: 10,
    })
    try {
      const result = await harness.run()
      expect(result.ok).toBe(false)
      expect(harness.requests()).toBe(1)
      expect(harness.notices).toEqual([])
    } finally {
      harness.stop()
    }
  })
})
