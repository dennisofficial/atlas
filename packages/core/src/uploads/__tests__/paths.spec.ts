import { describe, expect, test } from 'bun:test'
import { MAX_MESSAGE_UPLOADS, MAX_UPLOAD_BYTES } from '../limits'
import { uploadPathOf } from '../paths'

describe('uploadPathOf', () => {
  test('joins the uploads dir, id and name', () => {
    expect(uploadPathOf({ uploadId: 'abc', name: 'a.txt' })).toBe('uploads/abc/a.txt')
  })
})

describe('limits', () => {
  test('are the agreed values', () => {
    expect(MAX_UPLOAD_BYTES).toBe(104857600)
    expect(MAX_MESSAGE_UPLOADS).toBe(20)
  })
})
