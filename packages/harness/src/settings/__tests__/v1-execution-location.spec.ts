import {
  choiceValueOf,
  definitionsOfPage,
  EExecutionLocation,
  ESettingId,
  ESettingKind,
  ESettingPage,
  ESettingsLayer,
  resolveSettings,
  type ChoiceDefinition,
} from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'

import { V1_ONLY_SETTING_DEFINITIONS } from '../v1-only-definitions'

const definitionOf = (id: ESettingId): ChoiceDefinition => {
  const found = V1_ONLY_SETTING_DEFINITIONS.find((definition) => definition.id === id)
  if (found === undefined) throw new Error(`${id} is not a registered setting`)
  if (found.kind !== ESettingKind.Choice) throw new Error(`${id} is not a choice`)
  return found
}

const resolutionOver = (args: { file?: Record<string, unknown>; env?: Record<string, unknown> }) =>
  resolveSettings({
    definitions: V1_ONLY_SETTING_DEFINITIONS,
    layers: [
      { layer: ESettingsLayer.User, origin: 'settings.json', values: args.file ?? {} },
      { layer: ESettingsLayer.Environment, origin: 'environment', values: args.env ?? {} },
    ],
  })

describe('the default execution location', () => {
  it('is a choice between the host and a docker container, shipped on the host', () => {
    const definition = definitionOf(ESettingId.ExecutionLocation)

    expect(definition.fallback).toBe(EExecutionLocation.Host)
    expect(definition.options.map((option) => option.value)).toEqual([
      EExecutionLocation.Host,
      EExecutionLocation.Docker,
    ])
  })

  it('answers to the environment, so a launch script can set it without a file', () => {
    expect(definitionOf(ESettingId.ExecutionLocation).environmentVariable).toBe(
      'ATLAS_EXECUTION_LOCATION',
    )
  })

  it('sits on a page the settings overlay walks, beside the other policy knobs', () => {
    expect(
      definitionsOfPage({
        definitions: V1_ONLY_SETTING_DEFINITIONS,
        page: ESettingPage.General,
      }).map((definition) => definition.id),
    ).toContain(ESettingId.ExecutionLocation)
  })

  it('resolves out of a settings file, so a project can switch its own default', () => {
    const resolution = resolutionOver({ file: { [ESettingId.ExecutionLocation]: 'docker' } })

    expect(
      choiceValueOf({
        resolution,
        id: ESettingId.ExecutionLocation,
        fallback: EExecutionLocation.Host,
      }),
    ).toBe(EExecutionLocation.Docker)
  })

  it('rejects a location Atlas does not know rather than starting in one', () => {
    const resolution = resolutionOver({ file: { [ESettingId.ExecutionLocation]: 'podman' } })

    expect(
      choiceValueOf({
        resolution,
        id: ESettingId.ExecutionLocation,
        fallback: EExecutionLocation.Host,
      }),
    ).toBe(EExecutionLocation.Host)
    expect(resolution.rejected.map((one) => one.id)).toContain(ESettingId.ExecutionLocation)
  })
})
