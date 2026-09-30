import { describe, expect, it } from 'bun:test'
import { EMessageOrigin, toThreadId } from '@dltech/atlas-core'
import { createPendingQueues } from '@dltech/atlas-harness'
import { testRender } from '@opentui/react/test-utils'
import React from 'react'

import { pendingRows } from '../../../../store/pending-rows'
import { PendingBlock, pendingRuns } from '../pending-block'

const THREAD = toThreadId('child')

describe('message origin in shared pending rows', () => {
  it('does not offer editing for an instruction another agent submitted', async () => {
    const pending = createPendingQueues()
    const queue = pending.forThread({ threadId: THREAD })
    queue.enqueue({ text: 'parent instruction', via: EMessageOrigin.ParentAgent })
    const rows = pendingRows({ entries: queue.getSnapshot(), notices: [], agents: [], services: [] })
    const setup = await testRender(<PendingBlock rows={rows} width={90} />, { width: 100, height: 15 })
    try {
      await setup.flush()
      expect(setup.captureCharFrame()).toContain('parent instruction')
      expect(setup.captureCharFrame()).not.toContain('↑ to edit')
      expect(queue.takeBackLast()).toBeNull()
    } finally {
      setup.renderer.destroy()
    }
  })

  it('keeps editable operator drafts separate from immutable agent instructions', () => {
    const pending = createPendingQueues()
    const queue = pending.forThread({ threadId: THREAD })
    queue.enqueue({ text: 'parent instruction', via: EMessageOrigin.ParentAgent })
    queue.enqueue({ text: 'operator draft' })
    const rows = pendingRows({ entries: queue.getSnapshot(), notices: [], agents: [], services: [] })
    expect(pendingRuns(rows)).toHaveLength(2)
    expect(queue.takeBackLast()?.text).toBe('operator draft')
    expect(queue.takeBackLast()).toBeNull()
  })
})
