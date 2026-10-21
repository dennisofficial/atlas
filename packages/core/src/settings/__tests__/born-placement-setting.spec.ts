import { describe, expect, it } from 'vitest'

import { ESettingId, ATLAS_SETTINGS } from '../registry'
import { ESettingPage, definitionsOfPage } from '../definition'
import { ESettingsLayer } from '../layers'
import { choiceValueOf, resolveSettings } from '../resolve'
import { ESettingKind } from '../value'

const resolutionOver = (file: Record<string, unknown>) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [{ layer: ESettingsLayer.User, origin: 'settings.json', values: file }],
  })

const lastChoiceOf = (file: Record<string, unknown>): string =>
  choiceValueOf({
    resolution: resolutionOver(file),
    id: ESettingId.LastBornPlacement,
    fallback: 'unreachable',
  })

describe('the last chosen born placement', () => {
  it('is a hidden choice, written by the footer chip rather than a settings row', () => {
    const definition = ATLAS_SETTINGS.find((one) => one.id === ESettingId.LastBornPlacement)

    expect(definition?.kind).toBe(ESettingKind.Choice)
    expect(definition?.page).toBe(ESettingPage.Hidden)
    expect(
      definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.Hidden }).map((row) => row.id),
    ).toContain(ESettingId.LastBornPlacement)
  })

  it('reads as automatic until the operator flips the chip', () => {
    expect(lastChoiceOf({})).toBe('auto')
  })

  it('remembers the local and Vercel runners, and rejects anything else', () => {
    expect(lastChoiceOf({ [ESettingId.LastBornPlacement]: 'local' })).toBe('local')
    expect(lastChoiceOf({ [ESettingId.LastBornPlacement]: 'vercel' })).toBe('vercel')
    expect(lastChoiceOf({ [ESettingId.LastBornPlacement]: 'host' })).toBe('auto')
  })
})
