import { describe, expect, it } from 'bun:test'

import { eventBodySchema } from '../schema'

const started = { type: 'background-shell-started', shellId: 'shell-1', command: 'sleep 1' }

describe('background-shell-started', () => {
  it('decodes without a cwd', () => {
    expect(eventBodySchema.safeParse(started).success).toBe(true)
  })

  it('decodes with a cwd and keeps it', () => {
    const parsed = eventBodySchema.safeParse({ ...started, cwd: '/work' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && 'cwd' in parsed.data ? parsed.data.cwd : undefined).toBe('/work')
  })

  it('rejects an empty cwd', () => {
    expect(eventBodySchema.safeParse({ ...started, cwd: '' }).success).toBe(false)
  })
})
