import { describe, expect, it } from 'bun:test'

import { ESettingId } from '@dltech/atlas-core'
import { singleResponsibilityPolicy } from '@dltech/atlas-plugin-quality/review'
import type { Db } from '@dltech/atlas-db'

import { setting } from './model-config.fixture'
import { qualitySettingsPort } from '../quality-settings'

const rowsOf = (values: Record<string, unknown>) =>
  Object.entries(values).map(([key, value]) => ({ key, value: setting(value) }))

const fakeDb = (args: {
  session: { userId: string; projectId: string | null } | null
  user?: Record<string, unknown> | undefined
  project?: Record<string, unknown> | undefined
}): Db =>
  ({
    orm: {
      public: {
        Session: { first: async () => args.session },
        UserSetting: { where: () => ({ all: async () => rowsOf(args.user ?? {}) }) },
        ProjectSetting: { where: () => ({ all: async () => rowsOf(args.project ?? {}) }) },
        Project: { first: async () => null },
      },
    },
  }) as unknown as Db

const OWNER = { userId: 'user-1', projectId: 'project-1' }

describe('qualitySettingsPort', () => {
  it('reports the review off when the session has no owner', async () => {
    const port = qualitySettingsPort({ db: fakeDb({ session: null }), exampleUsers: [] })
    expect(await port.settings('s-1')).toEqual({ enabled: false, policies: {}, examples: false })
  })

  it('reads the master switch and the policy switches of the owner', async () => {
    const port = qualitySettingsPort({
      db: fakeDb({
        session: OWNER,
        user: {
          [ESettingId.QualityEnabled]: true,
          [singleResponsibilityPolicy.settingKey]: false,
        },
      }),
      exampleUsers: [],
    })

    expect(await port.settings('s-1')).toEqual({
      enabled: true,
      policies: { [singleResponsibilityPolicy.settingKey]: false },
      examples: false,
    })
  })

  it('lets a project setting override the user setting', async () => {
    const port = qualitySettingsPort({
      db: fakeDb({
        session: OWNER,
        user: { [ESettingId.QualityEnabled]: true },
        project: { [ESettingId.QualityEnabled]: false },
      }),
      exampleUsers: [],
    })

    expect((await port.settings('s-1')).enabled).toBe(false)
  })

  it('sends examples for an owner on the allowlist only', async () => {
    const allowed = qualitySettingsPort({
      db: fakeDb({ session: OWNER }),
      exampleUsers: [OWNER.userId],
    })
    const stranger = qualitySettingsPort({
      db: fakeDb({ session: OWNER }),
      exampleUsers: ['someone-else'],
    })

    expect((await allowed.settings('s-1')).examples).toBe(true)
    expect((await stranger.settings('s-1')).examples).toBe(false)
  })
})
