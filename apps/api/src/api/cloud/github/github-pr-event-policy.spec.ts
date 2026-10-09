import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '../../../generated/prisma/client'

vi.mock('../../../db', async () => {
  const { fakeGithubDb } = await import('../../../../test/fake-github-db.js')
  return { db: fakeGithubDb().db as unknown as PrismaClient }
})

import { fakeGithubDb } from '../../../../test/fake-github-db'
import {
  decodeSettingScalar,
  verdictTimingByUser,
  verdictTimingOf,
  VERDICT_TIMING_SETTING_KEY,
} from './github-pr-event-policy'

const fake = fakeGithubDb()

function seedSetting(args: { userId: string; key: string; value: string }): void {
  fake.cloudSettings.push({
    id: `set-${args.userId}-${args.key}`,
    userId: args.userId,
    key: args.key,
    value: args.value,
    createdAt: new Date(),
    updatedAt: new Date(),
  })
}

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
  beforeEach(() => {
    fake.reset()
  })

  it('resolves each user independently with one batched read', async () => {
    seedSetting({
      userId: 'usr-a',
      key: VERDICT_TIMING_SETTING_KEY,
      value: 'atlas-setting:v1:"settled"',
    })

    const resolved = await verdictTimingByUser({ userIds: ['usr-a', 'usr-b'] })

    expect(resolved.get('usr-a')).toBe('settled')
    expect(resolved.get('usr-b')).toBe('fail-fast')
  })

  it('ignores settings rows under other keys', async () => {
    seedSetting({ userId: 'usr-a', key: 'sandbox.image', value: 'atlas-setting:v1:"img"' })

    const resolved = await verdictTimingByUser({ userIds: ['usr-a'] })

    expect(resolved.get('usr-a')).toBe('fail-fast')
  })

  it('returns an empty map without querying for an empty fanout', async () => {
    const resolved = await verdictTimingByUser({ userIds: [] })
    expect(resolved.size).toBe(0)
  })
})
