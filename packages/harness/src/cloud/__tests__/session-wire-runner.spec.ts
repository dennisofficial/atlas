import { describe, expect, it } from 'bun:test'

import { ERunner } from '@dltech/atlas-core'

import { threadFromWire, wireThreadSchema } from '../session-wire'

const wireThread = {
  id: 'brn_pod',
  head: 3,
  createdAt: '2026-10-29T00:00:00.000Z',
  updatedAt: '2026-10-29T00:00:00.000Z',
  workspace: '/atlas/workspaces/atlas',
  repo: null,
  executionLocation: 'cloud',
  runner: 'local',
}

describe('a thread read over the wire', () => {
  it('keeps the runner so a local pod never reads as a Vercel sandbox', () => {
    const thread = threadFromWire(wireThreadSchema.parse(wireThread))

    expect(thread.runner).toBe(ERunner.Local)
  })

  it('drops a runner it does not know rather than guessing one', () => {
    const thread = threadFromWire(wireThreadSchema.parse({ ...wireThread, runner: 'mainframe' }))

    expect(thread.runner).toBeUndefined()
  })
})
