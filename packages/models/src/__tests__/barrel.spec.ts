import { describe, expect, it } from 'bun:test'
import * as models from '../index'

describe('models barrel', () => {
  it('reaches the generated catalogue from the package root', () => {
    expect(typeof models.generatedCatalogue).toBe('function')
    expect(typeof models.generatedCards).toBe('function')
    expect(typeof models.cardsForProvider).toBe('function')
    expect(typeof models.withoutDatedDuplicates).toBe('function')
    expect(typeof models.enrichLiveCards).toBe('function')
    expect(models.GENERATED_MANIFEST.source).toBe('models.dev + api.inference.net')
  })

  it('resolves the same catalogue through the barrel as through the module', () => {
    expect(models.cardsForProvider('anthropic').length).toBeGreaterThan(0)
    expect(models.generatedCatalogue().size).toBe(models.GENERATED_MANIFEST.modelCount)
  })
})
