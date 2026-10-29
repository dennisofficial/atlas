import { describe, expect, it } from 'bun:test'

import {
  BACKEND_TRAITS,
  decisionsTokenNameOf,
  EDecisionsProvider as ECoreDecisionsProvider,
  secretNameOf,
} from '@dltech/atlas-core'

import { EDecisionsProvider, ESearchBackend } from '../../../fixtures/settings-decisions'
import { decisionsKeyTarget, searchKeyTarget } from '../agent-keys'

const wireBackendOf = (value: string): ESearchBackend => {
  const backend = Object.values(ESearchBackend).find((candidate) => String(candidate) === value)
  if (backend === undefined) throw new Error(`no wire backend for ${value}`)
  return backend
}

const wireProviderOf = (value: string): EDecisionsProvider => {
  const provider = Object.values(EDecisionsProvider).find(
    (candidate) => String(candidate) === value,
  )
  if (provider === undefined) throw new Error(`no wire provider for ${value}`)
  return provider
}

describe('agent key targets', () => {
  it('names the decision key after the selected provider', () => {
    expect(decisionsKeyTarget(EDecisionsProvider.Typesafe).name).toBe('decisions.token.typesafe')
    expect(decisionsKeyTarget(EDecisionsProvider.Custom).name).toBe('decisions.token.custom')
  })

  it('names the search key after the selected backend and skips DuckDuckGo', () => {
    expect(searchKeyTarget(ESearchBackend.Tavily)?.name).toBe('search.tavily')
    expect(searchKeyTarget(ESearchBackend.SearXNG)?.name).toBe('search.searxng')
    expect(searchKeyTarget(ESearchBackend.DuckDuckGo)).toBeNull()
  })

  it('matches the core secret names and key visibility', () => {
    for (const provider of Object.values(ECoreDecisionsProvider)) {
      expect(decisionsKeyTarget(wireProviderOf(provider)).name).toBe(
        decisionsTokenNameOf({ provider }),
      )
    }
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
