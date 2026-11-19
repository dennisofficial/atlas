import { EMPTY_CONTROL, type ControlSlot } from '@dltech/atlas-plugin-sdk'

import { subscriptionLeaseHook } from './lease-hook'
import { trackingTargetHook } from './tracking-target-hook'

export {
  DEFAULT_SUBSCRIPTION_TTL_MS,
  subscriptionLeaseHook,
} from './lease-hook'
export { TRACKING_TARGET_TTL_MS, trackingTargetHook } from './tracking-target-hook'

export const githubControl: ControlSlot = {
  ...EMPTY_CONTROL,
  hooks: [subscriptionLeaseHook, trackingTargetHook],
}
