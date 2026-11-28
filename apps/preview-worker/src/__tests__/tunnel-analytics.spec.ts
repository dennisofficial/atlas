import { describe, expect, it, spyOn } from 'bun:test'

import { DEFAULT_TUNNEL_WAIT } from '../tunnel-wait'
import worker, { handlePreviewRequest } from '../worker'

const HOSTNAME = '3000-abcdefghij.byatlas.dev'
const edgeError = () =>
  new Response('<div id="cf-error-details">Unavailable</div>', { status: 530 })

async function run(args: {
  answers: readonly (() => Response)[]
  document?: boolean
  captureFails?: boolean
}) {
  let now = 0
  let calls = 0
  const events: { url: string; body: unknown }[] = []
  const pending: Promise<unknown>[] = []
  const response = await handlePreviewRequest({
    request: new Request(`https://${HOSTNAME}/`, {
      headers: { 'sec-fetch-dest': args.document ? 'iframe' : 'script' },
    }),
    upstream: async () => {
      now += 40
      const answer = args.answers[Math.min(calls, args.answers.length - 1)]
      calls += 1
      if (answer === undefined) throw new Error('Missing answer')
      return answer()
    },
    tunnelWait: {
      ...DEFAULT_TUNNEL_WAIT,
      tries: 2,
      now: () => now,
      sleep: async (ms) => {
        now += ms
      },
    },
    analytics: {
      key: 'public-key',
      waitUntil: (promise) => {
        pending.push(promise)
      },
      capture: async (url, init) => {
        events.push({ url, body: JSON.parse(String(init?.body)) })
        if (args.captureFails) throw new Error('PostHog unavailable')
        return new Response('ok')
      },
    },
  })
  await Promise.all(pending)
  return { response, events }
}

describe('preview tunnel hold analytics', () => {
  it('threads the configured capture key and worker lifetime through the fetch entrypoint', async () => {
    const captured: unknown[] = []
    const pending: Promise<unknown>[] = []
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
          if (String(input) === 'https://us.i.posthog.com/i/v0/e/') {
            captured.push(JSON.parse(String(init?.body)))
            return new Response('ok')
          }
          return edgeError()
        },
        { preconnect: globalThis.fetch.preconnect },
      ),
    )
    try {
      const response = await worker.fetch(
        new Request(`https://${HOSTNAME}/`, { method: 'POST' }),
        { POSTHOG_KEY: 'configured-public-key' },
        {
          waitUntil: (promise) => {
            pending.push(promise)
          },
        },
      )
      expect(response.status).toBe(530)
      expect(pending).toHaveLength(1)
      await Promise.all(pending)
      expect(captured).toHaveLength(1)
      expect(captured[0]).toMatchObject({
        api_key: 'configured-public-key',
        event: 'preview_tunnel_hold',
        properties: { tries: 1, method: 'POST', document: false, outcome: 'raw_error' },
      })
    } finally {
      fetch.mockRestore()
    }
  })

  it.each([
    {
      outcome: 'ok',
      answers: [edgeError, () => new Response('ready')],
      document: true,
      status: 200,
    },
    { outcome: 'starting_page', answers: [edgeError], document: true, status: 503 },
    { outcome: 'raw_error', answers: [edgeError], document: false, status: 530 },
  ])(
    'captures a held request ending in $outcome',
    async ({ outcome, answers, document, status }) => {
      const { response, events } = await run({ answers, document })
      expect(response.status).toBe(status)
      expect(events).toEqual([
        {
          url: 'https://us.i.posthog.com/i/v0/e/',
          body: {
            api_key: 'public-key',
            event: 'preview_tunnel_hold',
            distinct_id: `preview:${HOSTNAME}`,
            properties: {
              preview_hostname: HOSTNAME,
              tries: 2,
              hold_ms: 580,
              outcome,
              method: 'GET',
              document,
              $process_person_profile: false,
            },
          },
        },
      ])
    },
  )

  it.each([() => new Response('ok'), () => new Response('Origin failed', { status: 502 })])(
    'does not capture normal traffic or an origin error',
    async (answer) => {
      const { events } = await run({ answers: [answer] })
      expect(events).toEqual([])
    },
  )

  it('does not let capture failure change the response', async () => {
    const { response, events } = await run({
      answers: [edgeError, () => new Response('ready')],
      captureFails: true,
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ready')
    expect(events).toHaveLength(1)
  })
})
