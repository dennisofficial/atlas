import { describe, expect, it } from 'bun:test'

import { EExecutionLocation, toEventId, toRunId, toThreadId } from '../../index'
import { homeDirectoryAfter, projectDirectoryOf } from '../worktree'
import type { Event } from '../../events/envelope'

const restored = '/host/repo/.atlas/worktrees/feature-a7c2'
const location: Event = {
  id: toEventId('evt_relocated'),
  threadId: toThreadId('brn_relocated'),
  runId: toRunId('run_relocated'),
  seq: 1,
  depth: 0,
  at: '2026-10-01T00:00:00.000Z',
  type: 'location-changed',
  from: EExecutionLocation.Cloud,
  to: EExecutionLocation.Host,
  cwd: restored,
}

describe('the restored workspace anchor', () => {
  it('uses the actual restored destination rather than the old launch checkout', () => {
    expect(projectDirectoryOf({ events: [location], launchDirectory: '/host/repo' })).toBe(restored)
    expect(homeDirectoryAfter({ drafts: [location], home: '/atlas/workspace' })).toBe(restored)
  })
})
