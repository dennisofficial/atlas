import { describe, expect, it } from 'bun:test'

import { renameSession } from '../rename-session'

describe('renameSession', () => {
  it('posts the rename command with the name', async () => {
    const inputs: unknown[] = []
    await renameSession({
      api: {
        command: (input) => {
          inputs.push(input)
          return Promise.resolve({})
        },
      },
      sessionId: 's1',
      name: 'Fix login',
    })
    expect(inputs).toEqual([{ sessionId: 's1', name: 'rename', args: { name: 'Fix login' } }])
  })
})
