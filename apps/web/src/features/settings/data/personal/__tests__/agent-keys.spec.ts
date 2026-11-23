import { describe, expect, it } from 'bun:test'

import { BACKEND_TRAITS, secretNameOf } from '@dltech/atlas-core'

import { ESearchBackend } from '../../../fixtures/settings-search'
import { searchKeyTarget } from '../agent-keys'

const wireBackendOf = (value: string): ESearchBackend => {
  const backend = Object.values(ESearchBackend).find((candidate) => String(candidate) === value)
  if (backend === undefined) throw new Error(`no wire backend for ${value}`)
  return backend
}

describe('agent key targets', () => {
  it('names the search key after the selected backend and skips DuckDuckGo', () => {
    expect(searchKeyTarget(ESearchBackend.Tavily)?.name).toBe('search.tavily')
    expect(searchKeyTarget(ESearchBackend.SearXNG)?.name).toBe('search.searxng')
    expect(searchKeyTarget(ESearchBackend.DuckDuckGo)).toBeNull()
  })

  it('matches the core secret names and key visibility', () => {
    for (const traits of Object.values(BACKEND_TRAITS)) {
      const target = searchKeyTarget(wireBackendOf(traits.backend))
      if (traits.keyLabel === undefined) {
        expect(target).toBeNull()
        continue
      }
      expect(target?.name).toBe(secretNameOf(traits.backend))
      expect(target?.masked).toBe(traits.masked)
    }
  })
})
