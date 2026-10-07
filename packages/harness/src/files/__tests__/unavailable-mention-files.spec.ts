import { describe, expect, it } from 'bun:test'

import { MENTION_FILES_CONNECTING, UnavailableMentionFiles } from '../unavailable-mention-files'

describe('UnavailableMentionFiles', () => {
  it('rejects every read with the connecting message and never answers locally', async () => {
    const files = new UnavailableMentionFiles()

    await expect(files.list('.')).rejects.toThrow(MENTION_FILES_CONNECTING)
    await expect(files.exists('package.json')).rejects.toThrow(MENTION_FILES_CONNECTING)
    await expect(files.load('package.json')).rejects.toThrow(MENTION_FILES_CONNECTING)
    expect(files.forget()).toBeUndefined()
  })
})
