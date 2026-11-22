import { ESettingId, rangeValueOf } from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'

/**
 * The creation-time size of a new cloud sandbox, from `sandbox.vcpus`. Existing sandboxes never
 * see it — Vercel ignores create params on resume — so the live resize is `/container resources`.
 */
export function sandboxVcpusOf(args: { settings: SettingsService }): number {
  return rangeValueOf({
    resolution: args.settings.snapshot().resolution,
    id: ESettingId.SandboxVcpus,
    fallback: 2,
  })
}
