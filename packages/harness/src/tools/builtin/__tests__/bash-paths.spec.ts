import { describe, expect, it } from 'bun:test'

import { bashDescription } from '../bash-prose'

describe('the bash session paths contract', () => {
  it('marks session and context directories shared and the thread directory private', () => {
    const description = bashDescription({ defaultTimeoutMs: 120_000, maximumTimeoutMs: 600_000 })

    expect(description).toContain('ATLAS_SESSION_DIR and ATLAS_CONTEXT_DIR name the session directories shared by the conversation and its agents')
    expect(description).toContain('ATLAS_THREAD_DIR names the thread directory private to the calling thread')
    expect(description).not.toContain('They are per-agent, not shared mutable state.')
  })
})
