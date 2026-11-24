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
      v2: { V2Session: { first: async () => args.session } },
      public: {
        UserSetting: { where: () => ({ all: async () => rowsOf(args.user ?? {}) }) },
        ProjectSetting: { where: () => ({ all: async () => rowsOf(args.project ?? {}) }) },
      },
    },
  }) as unknown as Db

const OWNER = { userId: 'user-1', projectId: 'project-1' }

describe('qualitySettingsPort', () => {
  it('reports the review off when the session has no owner', async () => {
    const port = qualitySettingsPort({ db: fakeDb({ session: null }) })
    expect(await port.settings('s-1')).toEqual({ enabled: false, policies: {} })
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
    })

    expect(await port.settings('s-1')).toEqual({
      enabled: true,
      policies: { [singleResponsibilityPolicy.settingKey]: false },
    })
  })

  it('lets a project setting override the user setting', async () => {
    const port = qualitySettingsPort({
      db: fakeDb({
        session: OWNER,
        user: { [ESettingId.QualityEnabled]: true },
        project: { [ESettingId.QualityEnabled]: false },
      }),
    })

    expect((await port.settings('s-1')).enabled).toBe(false)
  })
})
