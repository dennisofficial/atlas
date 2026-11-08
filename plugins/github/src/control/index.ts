import { EMPTY_CONTROL, type ControlSlot } from '@dltech/atlas-plugin-sdk'

import { subscriptionLeaseHook } from './lease-hook'

export {
  DEFAULT_SUBSCRIPTION_TTL_MS,
  subscriptionLeaseHook,
} from './lease-hook'

export const githubControl: ControlSlot = {
  ...EMPTY_CONTROL,
  hooks: [subscriptionLeaseHook],
}
