import { describe, expect, it } from 'bun:test'

import { ESettingPage, type ChoiceDefinition, type SettingDefinition } from '../definition'
import { activateSetting, adjustSetting } from '../edit'
import { ESettingsLayer } from '../layers'
import { resolveSettings } from '../resolve'
import { ESettingKind } from '../value'
import { choice, range, toggle } from './fixture'

const narrowed: ChoiceDefinition = {
  id: 'demo.narrowed',
  page: ESettingPage.Models,
  group: 'Demo',
  label: 'Demo narrowed',
  description: 'A choice whose options depend on the resolution.',
  kind: ESettingKind.Choice,
  fallback: 'medium',
  options: [
    { value: 'off', label: 'off' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high' },
    { value: 'max', label: 'max' },
  ],
  optionsFor: ({ resolution }) => {
    const held = resolution.settings.get('demo.narrowable')
    if (held?.value !== true) return narrowed.options
    return narrowed.options.filter((option) => option.value === 'off' || option.value === 'low')
  },
}

const narrowable: SettingDefinition = {
  id: 'demo.narrowable',
  page: ESettingPage.Models,
  group: 'Demo',
  label: 'Demo narrowable',
  description: 'The toggle the narrowed row reads.',
  kind: ESettingKind.Toggle,
  fallback: false,
}

const narrowedResolution = (narrow: boolean) =>
  resolveSettings({
    definitions: [narrowed, narrowable],
    layers: [
      {
        layer: ESettingsLayer.User,
        origin: 'spec',
        values: { 'demo.narrowable': narrow },
      },
    ],
  })

describe('activateSetting', () => {
  it('flips a toggle', () => {
    expect(activateSetting({ definition: toggle, current: true })).toBe(false)
    expect(activateSetting({ definition: toggle, current: false })).toBe(true)
  })

  it('walks a choice round the options', () => {
    expect(activateSetting({ definition: choice, current: 'ask' })).toBe('never')
    expect(activateSetting({ definition: choice, current: 'always' })).toBe('ask')
  })

  it('walks a range by its step and wraps at the top', () => {
    expect(activateSetting({ definition: range, current: 40 })).toBe(45)
    expect(activateSetting({ definition: range, current: 50 })).toBe(30)
  })

  it('recovers to the fallback when the held value is the wrong shape', () => {
    expect(activateSetting({ definition: range, current: 'forty' })).toBe(45)
    expect(activateSetting({ definition: choice, current: 12 })).toBe('never')
  })

  it('cycles only the options the resolution narrows the choice to', () => {
    const resolution = narrowedResolution(true)
    expect(activateSetting({ definition: narrowed, current: 'off', resolution })).toBe('low')
    expect(activateSetting({ definition: narrowed, current: 'low', resolution })).toBe('off')
  })

  it('cycles the full options when the resolution leaves the choice wide', () => {
    const resolution = narrowedResolution(false)
    expect(activateSetting({ definition: narrowed, current: 'low', resolution })).toBe('medium')
    expect(activateSetting({ definition: narrowed, current: 'max', resolution })).toBe('off')
  })

  it('moves a held value outside the narrowed options onto an offered one', () => {
    const resolution = narrowedResolution(true)
    expect(activateSetting({ definition: narrowed, current: 'max', resolution })).toBe('low')
    expect(adjustSetting({ definition: narrowed, current: 'max', delta: -1, resolution })).toBe(
      'off',
    )
  })

  it('keeps the static options when no resolution is given', () => {
    expect(activateSetting({ definition: narrowed, current: 'low' })).toBe('medium')
  })
})

describe('adjustSetting', () => {
  it('stops a choice at each end rather than wrapping', () => {
    expect(adjustSetting({ definition: choice, current: 'ask', delta: -1 })).toBe('ask')
    expect(adjustSetting({ definition: choice, current: 'always', delta: 1 })).toBe('always')
    expect(adjustSetting({ definition: choice, current: 'ask', delta: 2 })).toBe('always')
  })

  it('stops a range at its bounds', () => {
    expect(adjustSetting({ definition: range, current: 30, delta: -1 })).toBe(30)
    expect(adjustSetting({ definition: range, current: 50, delta: 1 })).toBe(50)
    expect(adjustSetting({ definition: range, current: 40, delta: 1 })).toBe(45)
  })

  it('reads a direction as on or off for a toggle', () => {
    expect(adjustSetting({ definition: toggle, current: true, delta: -1 })).toBe(false)
    expect(adjustSetting({ definition: toggle, current: false, delta: 1 })).toBe(true)
    expect(adjustSetting({ definition: toggle, current: false, delta: 0 })).toBe(false)
  })

  it('stops at the ends of the narrowed options', () => {
    const resolution = narrowedResolution(true)
    expect(adjustSetting({ definition: narrowed, current: 'off', delta: -1, resolution })).toBe(
      'off',
    )
    expect(adjustSetting({ definition: narrowed, current: 'off', delta: 1, resolution })).toBe(
      'low',
    )
    expect(adjustSetting({ definition: narrowed, current: 'max', delta: 1, resolution })).toBe(
      'low',
    )
    expect(adjustSetting({ definition: narrowed, current: 'low', delta: 1, resolution })).toBe(
      'low',
    )
  })
})
