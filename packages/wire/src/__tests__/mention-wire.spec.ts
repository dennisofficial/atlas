import { describe, expect, it } from 'bun:test'

import {
  CHANNEL_PROTOCOL_VERSION,
  EClientRequest,
  listMentionFilesParamsSchema,
  listMentionFilesReplySchema,
  mentionFileExistsParamsSchema,
  mentionFileExistsReplySchema,
  readMentionFileParamsSchema,
  readMentionFileReplySchema,
} from '../index'

describe('mention wire schemas', () => {
  it('names the ops and speaks protocol 21', () => {
    expect(String(EClientRequest.ListMentionFiles)).toBe('list-mention-files')
    expect(String(EClientRequest.MentionFileExists)).toBe('mention-file-exists')
    expect(String(EClientRequest.ReadMentionFile)).toBe('read-mention-file')
    expect(CHANNEL_PROTOCOL_VERSION).toBe(21)
  })

  it('wants exactly a thread and a directory or path', () => {
    expect(listMentionFilesParamsSchema.safeParse({ threadId: 't', directory: 'src' }).success).toBe(true)
    expect(listMentionFilesParamsSchema.safeParse({ threadId: 't' }).success).toBe(false)
    expect(listMentionFilesParamsSchema.safeParse({ threadId: '', directory: 'src' }).success).toBe(false)
    expect(listMentionFilesParamsSchema.safeParse({ threadId: 't', directory: 'src', extra: 1 }).success).toBe(false)
    expect(mentionFileExistsParamsSchema.safeParse({ threadId: 't', path: 'a' }).success).toBe(true)
    expect(mentionFileExistsParamsSchema.safeParse({ threadId: 't', directory: 'a' }).success).toBe(false)
    expect(readMentionFileParamsSchema.safeParse({ path: 'a' }).success).toBe(false)
    expect(readMentionFileParamsSchema.safeParse({ threadId: 't', path: 'a', more: true }).success).toBe(false)
  })

  it('parses each reply strictly', () => {
    expect(listMentionFilesReplySchema.parse({ entries: [{ name: 'a', isDirectory: false }] }).entries).toHaveLength(1)
    expect(listMentionFilesReplySchema.safeParse({ entries: [{ name: 'a' }] }).success).toBe(false)
    expect(mentionFileExistsReplySchema.parse({ exists: true })).toEqual({ exists: true })
    expect(mentionFileExistsReplySchema.safeParse({ exists: 'yes' }).success).toBe(false)
    expect(mentionFileExistsReplySchema.safeParse({ exists: true, extra: 1 }).success).toBe(false)
  })

  it('parses the three loaded-file shapes with their path and rejects the rest', () => {
    const text = { type: 'text', path: 'a.ts', content: 'x', truncated: false } as const
    const listing = { type: 'listing', path: 'src', content: 'a\nb/' } as const
    const refused = { type: 'refused', path: 'bin', reason: 'it is binary' } as const
    for (const file of [text, listing, refused]) {
      expect(readMentionFileReplySchema.parse({ file }).file).toEqual(file)
    }
    expect(readMentionFileReplySchema.safeParse({ file: { type: 'text', content: 'x', truncated: false } }).success).toBe(false)
    expect(readMentionFileReplySchema.safeParse({ file: { type: 'image', path: 'a', data: '' } }).success).toBe(false)
    expect(readMentionFileReplySchema.safeParse({ file: { ...refused, extra: 1 } }).success).toBe(false)
  })
})
