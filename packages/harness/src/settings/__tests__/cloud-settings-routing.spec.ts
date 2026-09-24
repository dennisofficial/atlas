import { describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingsLayer,
  type SettingDefinition,
} from '@dltech/atlas-core'

import { CLOUD_SETTING_DEFINITIONS, isCloudSettingId } from '../../cloud/settings-definitions'
import { environmentLayer } from '../environment'
import { MemorySettingsStore } from '../memory-store'
import { createSettingsService, type CloudSettingsPort } from '../service'

const definitions: readonly SettingDefinition[] = [
  ...ATLAS_SETTINGS.filter((definition) => !isCloudSettingId(definition.id)),
  ...CLOUD_SETTING_DEFINITIONS,
]

type CloudFake = CloudSettingsPort & {
  writes: { key: string; value: string }[]
  removals: string[]
  failWrites: boolean
  notify: () => void
}

const cloudFake = (args: {
  signedIn: boolean
  values?: Record<string, string>
}): CloudFake => {
  const listeners = new Set<() => void>()
  const fake: CloudFake = {
    writes: [],
    removals: [],
    failWrites: false,
    signedIn: () => args.signedIn,
    values: () => args.values ?? {},
    set: (write: { key: string; value: string }) => {
      if (fake.failWrites) return Promise.reject(new Error('cloud is down'))
      fake.writes.push(write)
      return Promise.resolve()
    },
    remove: (removal: { key: string }) => {
      if (fake.failWrites) return Promise.reject(new Error('cloud is down'))
      fake.removals.push(removal.key)
      return Promise.resolve()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    notify: () => {
      for (const listener of listeners) listener()
    },
  }
  return fake
}

const serviceWith = (args: {
  user: MemorySettingsStore
  env?: Record<string, string>
  cloud?: CloudSettingsPort
}) =>
  createSettingsService({
    definitions,
    user: args.user,
    ...(args.env === undefined
      ? {}
      : { environment: environmentLayer({ definitions, env: args.env }) }),
    ...(args.cloud === undefined ? {} : { cloud: args.cloud }),
  })

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('settings service cloud routing', () => {
  it('never serves a cloud setting id from the local user file', () => {
    const service = serviceWith({
      user: new MemorySettingsStore({
        document: { values: { [ESettingId.VercelTeamId]: 'team_local' } },
      }),
    })

    const held = service.snapshot().resolution.settings.get(ESettingId.VercelTeamId)
    expect(held?.value).toBe('')
    expect(held?.layer).toBe(ESettingsLayer.Default)
  })

  it('never serves a cloud setting id from the project file either', () => {
    const service = createSettingsService({
      definitions,
      user: new MemorySettingsStore(),
      project: new MemorySettingsStore({
        document: { values: { [ESettingId.SandboxImage]: 'local-image' } },
      }),
    })

    const held = service.snapshot().resolution.settings.get(ESettingId.SandboxImage)
    expect(held?.value).toBe('atlas-sandbox:latest')
    expect(held?.layer).toBe(ESettingsLayer.Default)
  })

  it('applies the environment fallback while signed out', () => {
    const service = serviceWith({
      user: new MemorySettingsStore(),
      env: { VERCEL_TEAM_ID: 'team_env' },
      cloud: cloudFake({ signedIn: false, values: { [ESettingId.VercelTeamId]: 'team_cloud' } }),
    })

    const held = service.snapshot().resolution.settings.get(ESettingId.VercelTeamId)
    expect(held?.value).toBe('team_env')
    expect(held?.layer).toBe(ESettingsLayer.Environment)
  })

  it('lets the cloud layer win over the environment while signed in', () => {
    const service = serviceWith({
      user: new MemorySettingsStore(),
      env: { VERCEL_TEAM_ID: 'team_env' },
      cloud: cloudFake({ signedIn: true, values: { [ESettingId.VercelTeamId]: 'team_cloud' } }),
    })

    const held = service.snapshot().resolution.settings.get(ESettingId.VercelTeamId)
    expect(held?.value).toBe('team_cloud')
    expect(held?.layer).toBe(ESettingsLayer.Cloud)
    expect(held?.origin).toBe('atlas cloud')
  })

  it('never serves cloud.url from the cloud layer — it bootstraps the client itself', () => {
    const service = serviceWith({
      user: new MemorySettingsStore(),
      cloud: cloudFake({
        signedIn: true,
        values: { [ESettingId.CloudUrl]: 'https://cloud.example' },
      }),
    })

    const held = service.snapshot().resolution.settings.get(ESettingId.CloudUrl)
    expect(held?.value).toBe('https://api.byatlas.io')
    expect(held?.layer).toBe(ESettingsLayer.Default)
  })

  it('routes a set to the cloud store and leaves the local file alone', async () => {
    const user = new MemorySettingsStore()
    const cloud = cloudFake({ signedIn: true })
    const service = serviceWith({ user, cloud })

    expect(service.set({ id: ESettingId.VercelTeamId, value: 'team_new' })).toEqual({ ok: true })
    await flush()

    expect(cloud.writes).toEqual([{ key: ESettingId.VercelTeamId, value: 'team_new' }])
    expect(user.document().values[ESettingId.VercelTeamId]).toBeUndefined()
  })

  it('routes a clear to the cloud store', async () => {
    const cloud = cloudFake({ signedIn: true })
    const service = serviceWith({ user: new MemorySettingsStore(), cloud })

    expect(service.clear({ id: ESettingId.SandboxImage })).toEqual({ ok: true })
    await flush()

    expect(cloud.removals).toEqual([ESettingId.SandboxImage])
  })

  it('fails a set with the sign-in message while signed out', () => {
    const cloud = cloudFake({ signedIn: false })
    const service = serviceWith({ user: new MemorySettingsStore(), cloud })

    expect(service.set({ id: ESettingId.VercelTeamId, value: 'team_new' })).toEqual({
      ok: false,
      message: 'sign in to Atlas Cloud to change this',
    })
    expect(cloud.writes).toHaveLength(0)
  })

  it('republishes when the cloud store notifies', () => {
    const cloud = cloudFake({ signedIn: true })
    const service = serviceWith({ user: new MemorySettingsStore(), cloud })
    const before = service.version()

    cloud.notify()

    expect(service.version()).toBe(before + 1)
  })

  it('surfaces a failed cloud write in the problems of the next snapshot', async () => {
    const cloud = cloudFake({ signedIn: true })
    cloud.failWrites = true
    const service = serviceWith({ user: new MemorySettingsStore(), cloud })

    expect(service.set({ id: ESettingId.VercelTeamId, value: 'team_new' })).toEqual({ ok: true })
    await flush()

    const problems = service.snapshot().problems
    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain('cloud is down')
  })
})
