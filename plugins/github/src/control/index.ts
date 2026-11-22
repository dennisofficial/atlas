import { EMPTY_CONTROL, type ControlSlot } from '@dltech/atlas-plugin-sdk'

import { trackingTargetHook } from './tracking-target-hook'

export { TRACKING_TARGET_TTL_MS, trackingTargetHook } from './tracking-target-hook'

export const githubControl: ControlSlot = {
  ...EMPTY_CONTROL,
  hooks: [trackingTargetHook],
}
