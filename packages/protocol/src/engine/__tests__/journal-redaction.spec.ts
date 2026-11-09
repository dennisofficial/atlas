import { describe, expect, it } from 'bun:test'

import { journalOp } from '../call-store'

describe('journalOp', () => {
  it('keeps a tunnel token out of the persisted previews.expose op', () => {
    const persisted = journalOp({ op: 'previews.expose', port: 3000, tunnelToken: 'secret' })
    expect(persisted).toEqual({ op: 'previews.expose', port: 3000, tunnelToken: '[redacted]' })
  })

  it('leaves every other op as it is', () => {
    const op = { op: 'services.list' } as const
    expect(journalOp(op)).toBe(op)
  })
})
