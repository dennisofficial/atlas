import { describe, expect, it } from 'bun:test'
import { MockLanguageModelV4 } from 'ai/test'
import { EUtilityModelRole } from '@dltech/atlas-core'
import { notifyingUtilityFallback } from '../utility-model'
import { recordingNotices } from './fakes'

describe('utility session fallback notices', () => {
  it.each(Object.values(EUtilityModelRole))(
    'reports a failed session fallback for %s',
    async (role) => {
      const notices = recordingNotices()
      const fault = new Error('session credentials expired')
      const fallback = notifyingUtilityFallback({
        role,
        notice: notices.port,
        fallback: () =>
          new MockLanguageModelV4({
            provider: 'openai',
            modelId: 'gpt-session',
            doGenerate: async () => {
              throw fault
            },
          }),
      })()
      expect(fallback).toBeDefined()
      if (fallback === undefined) throw new Error('expected fallback')

      await expect(fallback.doGenerate({ prompt: [] })).rejects.toBe(fault)

      expect(notices.posts).toHaveLength(1)
      expect(notices.posts[0]?.key).toBe(`utility-model:${role}:fallback-failed`)
      expect(notices.posts[0]?.text).toContain('fallback session model openai/gpt-session failed')
      expect(notices.posts[0]?.text).toContain('session credentials expired')
    },
  )

  it('leaves an unavailable fallback unavailable', () => {
    const notices = recordingNotices()
    const fallback = notifyingUtilityFallback({
      role: EUtilityModelRole.Titler,
      notice: notices.port,
      fallback: () => undefined,
    })()
    expect(fallback).toBeUndefined()
    expect(notices.posts).toHaveLength(0)
  })
})
