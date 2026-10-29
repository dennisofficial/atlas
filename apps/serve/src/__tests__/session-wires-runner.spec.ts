import { describe, expect, it } from 'bun:test'

import { ERunner, toThreadId } from '@dltech/atlas-core'

import { wireThreadOf } from '../session-wires'

describe('wireThreadOf', () => {
  it('carries the runner the thread was born on', () => {
    const wire = wireThreadOf({
      id: toThreadId('brn_pod'),
      head: 0,
      createdAt: '2026-10-29T00:00:00.000Z',
      updatedAt: '2026-10-29T00:00:00.000Z',
      workspace: '/atlas/workspaces/atlas',
      repo: null,
      runner: ERunner.Local,
    })

    expect(wire.runner).toBe(ERunner.Local)
  })
})
