import { describe, expect, it } from 'bun:test'

import { sessionDirectoriesDescription } from '../../../execution/session-environment'
import { bashDescription } from '../bash-prose'

describe('the bash session paths contract', () => {
  it('names the session, context and thread directories with the layout they really have', () => {
    const description = bashDescription({ defaultTimeoutMs: 120_000, maximumTimeoutMs: 600_000 })

    expect(description).toContain(sessionDirectoriesDescription)
    expect(description).toContain(
      'ATLAS_CONTEXT_DIR is $ATLAS_SESSION_DIR/context, the shared context folder that survives compaction',
    )
    expect(description).toContain(
      'ATLAS_THREAD_DIR is $ATLAS_SESSION_DIR/threads/<thread id>, private to the calling thread',
    )
    expect(description).not.toContain('They are per-agent, not shared mutable state.')
  })
})
