import { registerDom, unregisterDom } from '@/lib/__tests__/happy-dom-globals'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { EDetailsMorphSurface, isSurfaceSwap, morphSessionDetails } from '../details-morph'

beforeAll(() => registerDom())

afterAll(async () => {
  await unregisterDom()
})

const card = EDetailsMorphSurface.Card
const pane = EDetailsMorphSurface.Pane

describe('isSurfaceSwap', () => {
  test('the card growing into the pane is a swap', () => {
    expect(isSurfaceSwap({ before: new Set([card]), after: new Set([pane]) })).toBe(true)
  })

  test('the pane shrinking back into the card is a swap', () => {
    expect(isSurfaceSwap({ before: new Set([pane]), after: new Set([card]) })).toBe(true)
  })

  test('the pane opening with no card is not a swap', () => {
    expect(isSurfaceSwap({ before: new Set(), after: new Set([pane]) })).toBe(false)
  })

  test('the card closing on its own is not a swap', () => {
    expect(isSurfaceSwap({ before: new Set([card]), after: new Set() })).toBe(false)
  })
})

describe('morphSessionDetails', () => {
  test('applies the update at once where the browser has no view transitions', () => {
    let applied = false
    morphSessionDetails(() => {
      applied = true
    })
    expect(applied).toBe(true)
  })
})
