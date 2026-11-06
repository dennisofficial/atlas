import { describe, expect, it } from 'bun:test'

import { EPreviewGate } from '@/features/desktop/use-preview-origins'

import { allowedAfter } from '../use-allowed-frames'

const A = 'https://3005-abcdefghij.byatlas.dev'
const B = 'https://6006-abcdefghij.byatlas.dev'

describe('allowedAfter', () => {
  it('keeps what the host last confirmed while a new list is waiting', () => {
    const held = new Set([A])
    expect(allowedAfter({ held, gate: EPreviewGate.Waiting, urls: [`${A}/`, `${B}/`] })).toBe(held)
    expect(allowedAfter({ held, gate: EPreviewGate.Failed, urls: [`${B}/`] })).toBe(held)
  })

  it('takes exactly the confirmed origins once the host is ready', () => {
    const next = allowedAfter({
      held: new Set([A]),
      gate: EPreviewGate.Ready,
      urls: [`${A}/x`, `${B}/`],
    })
    expect([...next].sort()).toEqual([A, B])
  })

  it('forgets an origin the host dropped, so reopening it waits for the host again', () => {
    const closed = allowedAfter({ held: new Set([A]), gate: EPreviewGate.Ready, urls: [] })
    expect(closed.size).toBe(0)
    expect(allowedAfter({ held: closed, gate: EPreviewGate.Waiting, urls: [`${A}/`] }).has(A)).toBe(
      false,
    )
  })

  it('returns the same set when nothing changed', () => {
    const held = new Set([A])
    expect(allowedAfter({ held, gate: EPreviewGate.Ready, urls: [`${A}/login`] })).toBe(held)
  })
})
