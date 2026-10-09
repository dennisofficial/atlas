import {
  ESettingId,
  choiceValueOf,
  type JsonValue,
  type LogPort,
} from '@dltech/atlas-core'

import type { SettingsService } from '../settings/service'
import { encodeSettingValue } from './sync-settings'

export type SettingsWriteThrough = Pick<
  { set: (args: { key: string; value: string }) => Promise<void> },
  'set'
>

export type WriteThroughBinding = {
  dispose: () => void
  idle: () => Promise<void>
}

const FALLBACK_VERDICT_TIMING = 'fail-fast'

/**
 * One key rides the write-through, by design: the verdict timing the API consults when a PR
 * delivery decides whether to wake a parked sandbox. Every other cloud-visible setting still
 * reaches the API only through the explicit upload on the settings Cloud page.
 */
const WRITE_THROUGH_IDS: readonly ESettingId[] = [ESettingId.PrVerdictTiming]

export function bindCloudSettingsWriteThrough(args: {
  settings: SettingsService
  store: () => SettingsWriteThrough | undefined
  log?: LogPort | undefined
}): WriteThroughBinding {
  const { settings, store, log } = args
  let chain: Promise<void> = Promise.resolve()

  const valueOf = (id: ESettingId): JsonValue =>
    choiceValueOf({
      resolution: settings.snapshot().resolution,
      id,
      fallback: FALLBACK_VERDICT_TIMING,
    })

  const lastSeen = new Map<string, JsonValue>(WRITE_THROUGH_IDS.map((id) => [id, valueOf(id)]))

  const push = (id: ESettingId): void => {
    const value = valueOf(id)
    if (lastSeen.get(id) === value) return
    lastSeen.set(id, value)
    const target = store()
    if (target === undefined) return
    const encoded = encodeSettingValue(value)
    chain = chain.then(() =>
      target.set({ key: id, value: encoded }).catch((error: unknown) => {
        log?.warn({
          source: 'cloud.settings-write-through',
          message: `could not write ${id} through to Atlas Cloud: ${error instanceof Error ? error.message : 'unknown failure'}`,
        })
      }),
    )
  }

  const handleChange = (): void => {
    for (const id of WRITE_THROUGH_IDS) push(id)
  }

  const dispose = settings.subscribe(handleChange)
  return { dispose, idle: () => chain }
}
