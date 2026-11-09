import { describe, expect, it } from 'bun:test'
import { decodeSettingValue } from '@dltech/atlas-wire/web'

import { memoryJsonStore } from '../../storage/json-store'
import {
  applyChanges,
  encodedChanges,
  jsonSettingsStorage,
  recordFromValues,
  valuesFromRecord,
} from '../settings-store'

describe('settings values', () => {
  it('round-trips a settings record', () => {
    const values = new Map<string, string | number | boolean>([
      ['model.id', 'anthropic/claude'],
      ['model.effort', 'high'],
      ['model.fast', true],
    ])

    expect(valuesFromRecord(recordFromValues(values))).toEqual(values)
  })

  it('drops a record of another version', () => {
    expect(valuesFromRecord({ version: 2, values: { 'model.effort': 'high' } })).toEqual(new Map())
  })

  it('keeps only scalar values', () => {
    expect(
      valuesFromRecord({
        version: 1,
        values: { 'model.effort': 'high', junk: { a: 1 }, nil: null },
      }),
    ).toEqual(new Map([['model.effort', 'high']]))
  })

  it('applies, replaces and clears changes', () => {
    const before = new Map<string, string | number | boolean>([['model.effort', 'low']])

    const expected = new Map<string, string | number | boolean>([['model.effort', 'high']])
    expected.set('model.fast', true)

    expect(applyChanges(before, { 'model.effort': 'high', 'model.fast': true })).toEqual(expected)
    expect(applyChanges(before, { 'model.effort': null })).toEqual(new Map())
  })

  it('encodes changes the way the API stores them', () => {
    const encoded = encodedChanges({ 'model.fast': true, 'model.effort': null })

    expect(encoded['model.effort']).toBeNull()
    expect(decodeSettingValue(encoded['model.fast'] as string)).toBe(true)
  })
})

describe('the JSON settings storage', () => {
  it('loads what it saved', async () => {
    const storage = jsonSettingsStorage({ store: memoryJsonStore() })

    await storage.save(new Map([['model.id', 'openai/gpt']]))

    expect(await storage.load()).toEqual(new Map([['model.id', 'openai/gpt']]))
  })

  it('loads nothing from a missing file', async () => {
    const storage = jsonSettingsStorage({ store: memoryJsonStore() })

    expect(await storage.load()).toEqual(new Map())
  })

  it('loads nothing from a corrupt file', async () => {
    const store = memoryJsonStore()
    await store.write('settings.json', 'garbage')
    const storage = jsonSettingsStorage({ store })

    expect(await storage.load()).toEqual(new Map())
  })

  it('clears the file', async () => {
    const storage = jsonSettingsStorage({ store: memoryJsonStore() })
    await storage.save(new Map([['model.id', 'openai/gpt']]))

    await storage.clear()

    expect(await storage.load()).toEqual(new Map())
  })
})
