import { useTestDatabase } from '@dltech/atlas-db/testing'
import { describe, expect, it } from 'bun:test'
import { ensureUser, seedUserSetting } from '../../../../test/github-seed'
import {
  decodeSettingScalar,
  verdictTimingByUser,
  verdictTimingOf,
  VERDICT_TIMING_SETTING_KEY,
} from './github-pr-event-policy'

describe('decodeSettingScalar', () => {
  it('unwraps the harness upload envelope', () => {
    expect(decodeSettingScalar('atlas-setting:v1:"settled"')).toBe('settled')
    expect(decodeSettingScalar('atlas-setting:v1:true')).toBe(true)
  })

  it('passes through plain strings and garbage envelopes unchanged', () => {
    expect(decodeSettingScalar('settled')).toBe('settled')
    expect(decodeSettingScalar('atlas-setting:v1:{broken')).toBe('atlas-setting:v1:{broken')
    expect(decodeSettingScalar('atlas-setting:v1:{"object":true}')).toBe(
      'atlas-setting:v1:{"object":true}',
    )
  })
})

describe('verdictTimingOf', () => {
  it('resolves the envelope-encoded settled value', () => {
    expect(verdictTimingOf('atlas-setting:v1:"settled"')).toBe('settled')
  })

  it('defaults to fail-fast when unset or unknown', () => {
    expect(verdictTimingOf(undefined)).toBe('fail-fast')
    expect(verdictTimingOf('atlas-setting:v1:"fail-fast"')).toBe('fail-fast')
    expect(verdictTimingOf('atlas-setting:v1:"garbage"')).toBe('fail-fast')
    expect(verdictTimingOf('atlas-setting:v1:42')).toBe('fail-fast')
    expect(verdictTimingOf('atlas-setting:v1:{broken')).toBe('fail-fast')
  })
})

describe('verdictTimingByUser', () => {
  useTestDatabase()
  it('resolves each user independently with one batched read', async () => {
    await ensureUser('usr-b')
    await seedUserSetting({
      userId: 'usr-a',
      key: VERDICT_TIMING_SETTING_KEY,
      value: 'atlas-setting:v1:"settled"',
    })

    const resolved = await verdictTimingByUser({ userIds: ['usr-a', 'usr-b'] })

    expect(resolved.get('usr-a')).toBe('settled')
    expect(resolved.get('usr-b')).toBe('fail-fast')
  })

  it('ignores settings rows under other keys', async () => {
    await seedUserSetting({
      userId: 'usr-a',
      key: 'sandbox.image',
      value: 'atlas-setting:v1:"img"',
    })

    const resolved = await verdictTimingByUser({ userIds: ['usr-a'] })

    expect(resolved.get('usr-a')).toBe('fail-fast')
  })

  it('returns an empty map without querying for an empty fanout', async () => {
    const resolved = await verdictTimingByUser({ userIds: [] })
    expect(resolved.size).toBe(0)
  })
})
