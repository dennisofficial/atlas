import { describe, expect, it } from 'bun:test'

import { PR_EDIT_MUTED_AUTHORS_FALLBACK, PR_EDIT_URGENT_AUTHORS_FALLBACK } from '@dltech/atlas-core'
import { CLOUD_SETTING_REGISTRY } from '@dltech/atlas-wire/web'

describe('pr edit author fallbacks', () => {
  it.each([
    ['muted', 'github.prEvents.editMutedAuthors', PR_EDIT_MUTED_AUTHORS_FALLBACK],
    ['urgent', 'github.prEvents.editUrgentAuthors', PR_EDIT_URGENT_AUTHORS_FALLBACK],
  ])('wire %s fallback equals the core fallback', (_name, key, coreFallback) => {
    expect(CLOUD_SETTING_REGISTRY.get(key)?.fallback).toBe(coreFallback)
  })
})
