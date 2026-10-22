import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'

import { NoticeStack } from '../../ui/components/notice-stack'
import { dismissNotice, ENoticeTone, notify } from '../../ui/notice-store'
import { frameOf } from '../../ui/__tests__/transcript-fixture'

afterEach(() => dismissNotice())

describe('the rendered package warning', () => {
  it('stays readable in narrow and wide terminals', async () => {
    dismissNotice()
    notify({
      text: 'package warning: OpenAI Responses (gpt-6.1-sol): omitted 2 incompatible historical reasoning parts; answers and tool calls are unchanged. — see logs.jsonl',
      tone: ENoticeTone.Warn,
      key: 'package-warning:probe',
      ttlMs: 15_000,
    })

    for (const width of [40, 100]) {
      const frame = await frameOf(<NoticeStack width={width} />, width)
      expect(frame).toContain('⚠ package warning:')
      expect(frame).toContain('gpt-6.1-sol')
      expect(frame).toContain('see logs.jsonl')
      expect(frame.split('\n').filter((row) => row.trim().length > 0).length).toBeLessThan(9)
    }
    dismissNotice()
  })
})
