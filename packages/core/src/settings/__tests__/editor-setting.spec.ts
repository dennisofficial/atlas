import { describe, expect, it } from 'bun:test'

import { definitionsOfPage, ESettingPage, type ChoiceDefinition } from '../definition'
import { ESettingsLayer } from '../layers'
import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { choiceValueOf, resolveSettings } from '../resolve'
import { ESettingKind } from '../value'

const definitionOf = (id: ESettingId): ChoiceDefinition => {
  const found = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (found === undefined) throw new Error(`${id} is not a registered setting`)
  if (found.kind !== ESettingKind.Choice) throw new Error(`${id} is not a choice`)
  return found
}

const resolutionOver = (args: { file?: Record<string, unknown>; env?: Record<string, unknown> }) =>
  resolveSettings({
    definitions: ATLAS_SETTINGS,
    layers: [
      { layer: ESettingsLayer.User, origin: 'settings.json', values: args.file ?? {} },
      { layer: ESettingsLayer.Environment, origin: 'environment', values: args.env ?? {} },
    ],
  })

describe('the transcript file editor', () => {
  it('is a choice between the OS default and the editors Atlas knows, shipped on the default', () => {
    const definition = definitionOf(ESettingId.Editor)

    expect(definition.fallback).toBe('default')
    expect(definition.options.map((option) => option.value)).toEqual([
      'default',
      'cursor',
      'code',
      'zed',
      'warp',
    ])
  })

  it('answers to the environment, so a launch script can set it without a file', () => {
    expect(definitionOf(ESettingId.Editor).environmentVariable).toBe('ATLAS_EDITOR')
  })

  it('sits on the General page the settings overlay walks', () => {
    expect(
      definitionsOfPage({ definitions: ATLAS_SETTINGS, page: ESettingPage.General }).map(
        (definition) => definition.id,
      ),
    ).toContain(ESettingId.Editor)
  })

  it('resolves out of a settings file, so a project can switch its own default', () => {
    const resolution = resolutionOver({ file: { [ESettingId.Editor]: 'cursor' } })

    expect(choiceValueOf({ resolution, id: ESettingId.Editor, fallback: 'default' })).toBe(
      'cursor',
    )
  })

  it('lets the environment override the file, so a launch can force an editor', () => {
    const resolution = resolutionOver({
      file: { [ESettingId.Editor]: 'cursor' },
      env: { [ESettingId.Editor]: 'zed' },
    })

    expect(choiceValueOf({ resolution, id: ESettingId.Editor, fallback: 'default' })).toBe('zed')
  })

  it('rejects an editor Atlas does not know rather than opening files in one', () => {
    const resolution = resolutionOver({ file: { [ESettingId.Editor]: 'emacs' } })

    expect(choiceValueOf({ resolution, id: ESettingId.Editor, fallback: 'default' })).toBe(
      'default',
    )
    expect(resolution.rejected.map((one) => one.id)).toContain(ESettingId.Editor)
  })
})
