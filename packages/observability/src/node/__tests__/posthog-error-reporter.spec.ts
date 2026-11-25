import { describe, expect, it } from 'bun:test'
import type { PostHog } from 'posthog-node'

import { PosthogErrorReporter } from '../posthog-error-reporter'
import { SERVER_ERROR_DISTINCT_ID } from '../posthog-config'

type Captured = {
  error: Error
  distinctId: string | undefined
  properties: Record<string, string | number | boolean> | undefined
}

const fakeClient = (args: { throws?: boolean } = {}) => {
  const captured: Captured[] = []
  const client = {
    captureException: (
      error: Error,
      distinctId?: string,
      properties?: Record<string, string | number | boolean>,
    ) => {
      if (args.throws === true) throw new Error('queue closed')
      captured.push({ error, distinctId, properties })
    },
  } as unknown as PostHog
  return { client, captured }
}

describe('PosthogErrorReporter', () => {
  it('captures the error under the fixed server distinct id', () => {
    const { client, captured } = fakeClient()
    const reporter = new PosthogErrorReporter({ client })
    const error = new Error('transaction open past its 30000ms deadline after 12 statements')

    reporter.report({
      error,
      properties: { source: 'db.transaction-deadline', durationMs: 30_010, statements: 12 },
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]?.error).toBe(error)
    expect(captured[0]?.distinctId).toBe(SERVER_ERROR_DISTINCT_ID)
    expect(captured[0]?.properties).toEqual({
      source: 'db.transaction-deadline',
      durationMs: 30_010,
      statements: 12,
    })
  })

  it('never throws when the client refuses the event', () => {
    const { client } = fakeClient({ throws: true })
    const reporter = new PosthogErrorReporter({ client })

    expect(() => reporter.report({ error: new Error('x'), properties: {} })).not.toThrow()
  })
})
