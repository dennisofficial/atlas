import { describe, expect, it } from 'bun:test'
import { ESkillScope } from '@dltech/atlas-wire/web'
import { toBase64Utf8 } from '../skill-content'
import {
  isSkillConflict,
  saveSkillTextWith,
  skillFileWriteOf,
  type SkillFileWrite,
} from '../skill-file-save'

const target = {
  scope: ESkillScope.Group,
  groupId: 'g',
  skill: 'test',
  path: 'SKILL.md',
  baseRevision: 2,
}
const hashOf = async (content: string) => `hash:${content}`
const read = async () => ({ content: toBase64Utf8('server'), revision: 3 })

describe('skill file save', () => {
  it('builds a hashed payload without an undefined revision', async () => {
    const { baseRevision: _, ...file } = target
    expect(await skillFileWriteOf({ target: file, content: 'YQ==', hashOf })).toEqual({
      ...file,
      content: 'YQ==',
      contentHash: 'hash:YQ==',
    })
  })
  it('preserves the scope and revision when saving UTF8', async () => {
    const writes: SkillFileWrite[] = []
    const result = await saveSkillTextWith({
      target,
      text: 'héllo',
      hashOf,
      read,
      put: async (input) => {
        writes.push(input)
        return 3
      },
    })
    expect(result).toEqual({ outcome: 'saved', revision: 3 })
    expect(writes[0]).toEqual({
      ...target,
      content: toBase64Utf8('héllo'),
      contentHash: `hash:${toBase64Utf8('héllo')}`,
    })
  })
  it('loads the latest text after a web or native conflict', async () => {
    for (const failure of [{ status: 409 }, { data: { httpStatus: 409 } }]) {
      expect(
        await saveSkillTextWith({
          target,
          text: 'mine',
          hashOf,
          read,
          put: async () => {
            throw failure
          },
        }),
      ).toEqual({ outcome: 'conflict', theirs: 'server', revision: 3 })
    }
  })
  it('does not swallow a network or permission failure', async () => {
    const failure = new Error('offline')
    await expect(
      saveSkillTextWith({
        target,
        text: 'mine',
        hashOf,
        read,
        put: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    for (const value of [
      null,
      undefined,
      '409',
      { status: 403 },
      { data: null },
      { data: { httpStatus: 500 } },
    ])
      expect(isSkillConflict(value)).toBe(false)
  })
})
