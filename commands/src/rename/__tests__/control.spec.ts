import { describe, expect, it } from 'bun:test'

import { renameHandler } from '../control'

describe('renameHandler', () => {
  it('renames the session through the plane', async () => {
    const calls: { sessionId: string; title: string }[] = []
    await renameHandler({
      plane: { renameSession: async (params) => void calls.push(params) },
      sessionId: 's1',
      args: { name: ' New name ' },
    })
    expect(calls).toEqual([{ sessionId: 's1', title: 'New name' }])
  })

  it('rejects invalid arguments without touching the plane', async () => {
    const calls: unknown[] = []
    const failed = renameHandler({
      plane: { renameSession: async (params) => void calls.push(params) },
      sessionId: 's1',
      args: { name: '' },
    })
    expect(failed).rejects.toThrow()
    await failed.catch(() => undefined)
    expect(calls).toEqual([])
  })
})
