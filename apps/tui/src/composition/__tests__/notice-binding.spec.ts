import { afterEach, describe, expect, it } from 'bun:test'

import { ENoticeTone } from '@dltech/atlas-core'

import { currentNotices, dismissNotice, NOTICE_WARN_MS } from '../../ui/notice-store'
import { noticePortBinding } from '../notice-binding'

afterEach(() => {
  dismissNotice()
})

describe('noticePortBinding', () => {
  it('posts a keyed notice with its tone and ttl', () => {
    const port = noticePortBinding()

    port.notify({ key: 'mcp:fs', text: 'server failed', tone: ENoticeTone.Warn, ttlMs: NOTICE_WARN_MS })

    const posted = currentNotices().find((notice) => notice.key === 'mcp:fs')
    expect(posted?.text).toBe('server failed')
    expect(posted?.tone).toBe(ENoticeTone.Warn)
    expect(posted?.ttlMs).toBe(NOTICE_WARN_MS)
  })

  it('posts a sticky notice when ttlMs is null', () => {
    const port = noticePortBinding()

    port.notify({ text: 'stands until cleared', tone: ENoticeTone.Info, ttlMs: null })

    const posted = currentNotices().find((notice) => notice.text === 'stands until cleared')
    expect(posted?.ttlMs).toBeNull()
  })

  it('generates a key when the post carries none', () => {
    const port = noticePortBinding()

    port.notify({ text: 'one', tone: ENoticeTone.Done, ttlMs: 1000 })
    port.notify({ text: 'two', tone: ENoticeTone.Done, ttlMs: 1000 })

    expect(currentNotices().filter((notice) => notice.text === 'one' || notice.text === 'two')).toHaveLength(2)
  })
})
