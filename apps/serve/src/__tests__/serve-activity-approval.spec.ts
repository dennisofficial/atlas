import { describe, expect, it } from 'bun:test'

import * as activity from '@dltech/atlas-harness/activity'

import { createApprovalWatcher } from '../serve-activity-approval'
import {
  activityOutcomeOf,
  createActivityTracker,
  NOOP_ACTIVITY_TRACKER,
} from '../serve-activity-state'

describe('serve activity compatibility exports', () => {
  it('retains the shared watcher and tracker implementations without a surface policy fork', () => {
    expect(createApprovalWatcher).toBe(activity.createApprovalWatcher)
    expect(createActivityTracker).toBe(activity.createActivityTracker)
    expect(activityOutcomeOf).toBe(activity.activityOutcomeOf)
    expect(NOOP_ACTIVITY_TRACKER).toBe(activity.NOOP_ACTIVITY_TRACKER)
  })
})
