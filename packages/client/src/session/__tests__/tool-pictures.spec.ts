import { describe, expect, it } from 'bun:test'

import { createToolPictureLoader, type WithheldToolPicture } from '../tool-pictures'

const picture = (overrides: Partial<WithheldToolPicture> = {}): WithheldToolPicture => ({
  kind: 'withheld',
  threadId: 'thread-1',
  seq: 9,
  part: 1,
  mediaType: 'image/png',
  ...overrides,
})

describe('createToolPictureLoader', () => {
  it('turns the bytes into a data url', async () => {
    const loader = createToolPictureLoader({
      fetch: async () => ({ mediaType: 'image/png', data: 'aGVsbG8=' }),
    })

    expect(await loader.dataUrlOf({ sessionId: 's', ...picture() })).toBe(
      'data:image/png;base64,aGVsbG8=',
    )
  })

  it('fetches one picture once for every caller that asks for it', async () => {
    let calls = 0
    const loader = createToolPictureLoader({
      fetch: async () => {
        calls += 1
        return { mediaType: 'image/png', data: 'aGVsbG8=' }
      },
    })

    const first = loader.dataUrlOf({ sessionId: 's', ...picture() })
    const second = loader.dataUrlOf({ sessionId: 's', ...picture() })

    expect(await first).toBe(await second)
    expect(calls).toBe(1)
  })

  it('fetches again after a failure', async () => {
    let calls = 0
    const loader = createToolPictureLoader({
      fetch: async () => {
        calls += 1
        if (calls === 1) throw new Error('offline')
        return { mediaType: 'image/png', data: 'aGVsbG8=' }
      },
    })

    await expect(loader.dataUrlOf({ sessionId: 's', ...picture() })).rejects.toThrow('offline')
    expect(await loader.dataUrlOf({ sessionId: 's', ...picture() })).toBe(
      'data:image/png;base64,aGVsbG8=',
    )
    expect(calls).toBe(2)
  })
})
