import { describe, expect, test } from 'bun:test'

import { ESelectLayout, humanizeOption, selectLayout } from '../tweak-options'

describe('humanizeOption', () => {
  test('turns kebab and snake case into a sentence', () => {
    expect(humanizeOption('resize-pending')).toBe('Resize pending')
    expect(humanizeOption('models_effort')).toBe('Models effort')
    expect(humanizeOption('none')).toBe('None')
    expect(humanizeOption('')).toBe('')
  })
})

describe('selectLayout', () => {
  test('short option sets of up to three are segmented', () => {
    expect(selectLayout({ options: ['populated', 'empty'] })).toBe(ESelectLayout.Segmented)
    expect(selectLayout({ options: ['a', 'b', 'c'] })).toBe(ESelectLayout.Segmented)
  })

  test('more than three options use a dropdown', () => {
    expect(selectLayout({ options: ['a', 'b', 'c', 'd'] })).toBe(ESelectLayout.Dropdown)
    expect(selectLayout({ options: ['connecting', 'connected', 'paused', 'disconnected'] })).toBe(
      ESelectLayout.Dropdown,
    )
  })

  test('three options with long labels use a dropdown', () => {
    expect(selectLayout({ options: ['resize-pending', 'running', 'parked'] })).toBe(
      ESelectLayout.Dropdown,
    )
  })

  test('the combined humanized length is capped at 24 characters', () => {
    expect(selectLayout({ options: ['x'.repeat(12), 'y'.repeat(12)] })).toBe(
      ESelectLayout.Segmented,
    )
    expect(selectLayout({ options: ['x'.repeat(12), 'y'.repeat(13)] })).toBe(ESelectLayout.Dropdown)
  })

  test('an empty list falls back to a dropdown', () => {
    expect(selectLayout({ options: [] })).toBe(ESelectLayout.Dropdown)
  })
})
