import { ESettingId, type SecretPrompt, type TextPrompt } from '@dltech/atlas-core'
import { describe, expect, it } from 'bun:test'
import { theme } from '../theme'
import {
  TEXT_DEFINITIONS,
  TEXT_ROW_STATE,
  WIDE,
  ORIGIN,
  SECRETS_ORIGIN,
  page,
  rowsOf,
  stateOf,
} from './settings-render-fixture'

describe('the search key row', () => {
  const KEY_ROW = stateOf(ESettingId.WebSearchKey)

  it('shows a value the settings layers never held, because a secret is read elsewhere', async () => {
    const rows = await rowsOf(
      page({
        secretOf: (id) =>
          id === ESettingId.WebSearchKey ? { text: '••••1234', fg: theme.ok } : undefined,
      }),
      WIDE,
    )
    const shown = rows.find((row) => row.toLowerCase().includes('search key'))

    expect(shown).toContain('••••1234')
    expect(shown).not.toContain(' on ')
  })

  it('puts the key row on the settings page, under the backend it belongs to', () => {
    expect(() => stateOf(ESettingId.WebSearchKey)).not.toThrow()
    expect(KEY_ROW.pageIndex).toBe(stateOf(ESettingId.WebSearchBackend).pageIndex)
  })

  it('offers the field instead of the preview band once it is being set', async () => {
    const prompt: SecretPrompt = {
      name: 'search.tavily',
      label: 'Tavily API key',
      masked: true,
      typed: 'tvly-abcd1234',
    }
    const rows = await rowsOf(page({ state: KEY_ROW, prompt }), WIDE)

    expect(rows.some((row) => row.includes('TAVILY API KEY'))).toBe(true)
    expect(rows.some((row) => row.includes('•••••••••1234'))).toBe(true)
    expect(rows.some((row) => row.includes('tvly-abcd'))).toBe(false)
  })

  it('says where the key is sealed, so nobody expects it in the settings file', async () => {
    const prompt: SecretPrompt = {
      name: 'search.tavily',
      label: 'Tavily API key',
      masked: true,
      typed: '',
    }
    const rows = await rowsOf(page({ state: KEY_ROW, prompt }), WIDE)

    expect(rows.some((row) => row.includes(SECRETS_ORIGIN))).toBe(true)
  })
})

describe('the text setting prompt', () => {
  it('offers the field instead of the preview band once the row is being edited', async () => {
    const textPrompt: TextPrompt = {
      id: 'demo.text',
      label: 'Demo text',
      typed: 'https://api.typesafe.ai/v1/systemone',
    }
    const rows = await rowsOf(
      page({ definitions: TEXT_DEFINITIONS, state: TEXT_ROW_STATE, textPrompt }),
      WIDE,
    )

    expect(rows.some((row) => row.includes('DEMO TEXT'))).toBe(true)
    expect(rows.some((row) => row.includes('https://api.typesafe.ai/v1/systemone'))).toBe(true)
  })

  it('writes to the settings file, so it says so rather than naming a vault', async () => {
    const textPrompt: TextPrompt = {
      id: 'demo.text',
      label: 'Demo text',
      typed: '',
    }
    const rows = await rowsOf(
      page({ definitions: TEXT_DEFINITIONS, state: TEXT_ROW_STATE, textPrompt }),
      WIDE,
    )

    expect(rows.some((row) => row.includes(`edits write to ${ORIGIN}`))).toBe(true)
    expect(rows.some((row) => row.includes(SECRETS_ORIGIN))).toBe(false)
  })
})
