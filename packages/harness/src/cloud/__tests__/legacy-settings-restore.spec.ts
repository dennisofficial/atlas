import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import {
  ATLAS_SETTINGS,
  ESettingId,
  ESettingsLayer,
  resolveSettings,
  type SettingsResolution,
} from '@dltech/atlas-core'

import { SecretCipher } from '../../credentials/secret-cipher'
import { FileSecretsStore } from '../../secrets/file-secrets-store'
import { MemorySettingsStore } from '../../settings/memory-store'
import { CLOUD_SETTING_DEFINITIONS } from '../settings-definitions'
import {
  legacyRestoreMarkerExists,
  restoreLegacySandboxConfiguration,
  type LegacyRestoreReport,
} from '../legacy-settings-restore'

let directory: string
let secretsFile: string
let keyFile: string
let markerFile: string

const realFetch = globalThis.fetch

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'atlas-legacy-restore-'))
  secretsFile = join(directory, 'secrets.json')
  keyFile = join(directory, 'key')
  markerFile = join(directory, 'legacy-cloud-settings-restored')
})

afterEach(() => {
  globalThis.fetch = realFetch
  rmSync(directory, { recursive: true, force: true })
})

const session = { url: 'https://cloud.test', token: 'fake-token', email: 'a@b.c' }

const secrets = () =>
  new FileSecretsStore({ file: secretsFile, cipher: new SecretCipher(keyFile) })

const settings = () => new MemorySettingsStore({ label: 'test' })

const encode = (value: string): string => `atlas-setting:v1:${JSON.stringify(value)}`

const resolutionFor = (values: Record<string, string>): SettingsResolution =>
  resolveSettings({
    definitions: [...ATLAS_SETTINGS, ...CLOUD_SETTING_DEFINITIONS],
    layers: [
      { layer: ESettingsLayer.User, origin: 'test', values },
    ],
  })

const fakeCloud = (rows: {
  secrets: { name: string; value: string }[]
  settings: { key: string; value: string }[]
}): void => {
  globalThis.fetch = Object.assign(
    async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/v1/secrets')) {
        return Response.json(
          { secrets: rows.secrets.map((row) => ({ ...row, updatedAt: '2026-09-30T00:00:00.000Z' })) },
          { status: 200 },
        )
      }
      if (url.endsWith('/v1/settings')) {
        return Response.json(
          { settings: rows.settings.map((row) => ({ ...row, updatedAt: '2026-09-30T00:00:00.000Z' })) },
          { status: 200 },
        )
      }
      return new Response(null, { status: 404 })
    },
    { preconnect: realFetch.preconnect },
  )
}

const run = async (args: {
  resolution: SettingsResolution
  secrets: FileSecretsStore
  settingsStore?: MemorySettingsStore
}): Promise<LegacyRestoreReport | undefined> =>
  restoreLegacySandboxConfiguration({
    session,
    resolution: args.resolution,
    secrets: args.secrets,
    ...(args.settingsStore === undefined ? {} : { settingsStore: args.settingsStore }),
    markerFile,
    clientVersion: 'test',
    fetchFn: globalThis.fetch,
  }).promise

describe('restoreLegacySandboxConfiguration', () => {
  it('no-ops when nothing is missing', async () => {
    const s = secrets()
    s.write({ name: ESettingId.VercelToken, value: 'fake-token' })
    const report = await run({
      resolution: resolutionFor({
        [ESettingId.VercelTeamId]: 'team_123',
        [ESettingId.VercelProjectId]: 'prj_456',
        [ESettingId.SandboxImage]: 'atlas-sandbox:latest',
      }),
      secrets: s,
      settingsStore: settings(),
    })
    expect(report).toBeUndefined()
  })

  it('restores missing sandbox config from cloud backup', async () => {
    fakeCloud({
      secrets: [{ name: ESettingId.VercelToken, value: 'vct-fake' }],
      settings: [
        { key: ESettingId.VercelTeamId, value: encode('team_abc') },
        { key: ESettingId.VercelProjectId, value: encode('prj_def') },
        { key: ESettingId.SandboxImage, value: encode('atlas-sandbox:1.0.0') },
      ],
    })

    const s = secrets()
    const st = settings()
    const report = await run({
      resolution: resolutionFor({}),
      secrets: s,
      settingsStore: st,
    })

    expect(report?.outcome).toBe('restored')
    expect(report?.restored).toContain('Vercel token')
    expect(report?.restored).toContain(ESettingId.VercelTeamId)
    expect(s.read(ESettingId.VercelToken)).toBe('vct-fake')
    expect(st.read().document.values[ESettingId.VercelTeamId]).toBe('team_abc')
    expect(legacyRestoreMarkerExists({ file: markerFile })).toBe(true)
  })

  it('never overwrites local values that already exist', async () => {
    const s = secrets()
    s.write({ name: ESettingId.VercelToken, value: 'local-token' })
    const st = settings()
    st.write({ values: { [ESettingId.VercelTeamId]: 'team_local' } })

    fakeCloud({
      secrets: [{ name: ESettingId.VercelToken, value: 'cloud-token' }],
      settings: [{ key: ESettingId.VercelTeamId, value: encode('team_cloud') }],
    })

    const report = await run({
      resolution: resolutionFor({ [ESettingId.VercelTeamId]: 'team_local' }),
      secrets: s,
      settingsStore: st,
    })

    expect(report?.restored ?? []).not.toContain('Vercel token')
    expect(report?.restored ?? []).not.toContain(ESettingId.VercelTeamId)
    expect(s.read(ESettingId.VercelToken)).toBe('local-token')
    expect(st.read().document.values[ESettingId.VercelTeamId]).toBe('team_local')
  })

  it('does not write a marker when the API is unreachable', async () => {
    globalThis.fetch = Object.assign(async () => {
      throw new Error('network down')
    }, { preconnect: realFetch.preconnect })

    const report = await run({
      resolution: resolutionFor({}),
      secrets: secrets(),
      settingsStore: settings(),
    })

    expect(report?.outcome).toBe('unreachable')
    expect(legacyRestoreMarkerExists({ file: markerFile })).toBe(false)
  })

  it('does not write a marker when the remote holds nothing', async () => {
    fakeCloud({ secrets: [], settings: [] })

    const report = await run({
      resolution: resolutionFor({}),
      secrets: secrets(),
      settingsStore: settings(),
    })

    expect(report?.outcome).toBe('incomplete')
    expect(legacyRestoreMarkerExists({ file: markerFile })).toBe(false)
  })

  it('reports malformed remote values without writing a marker', async () => {
    fakeCloud({
      secrets: [],
      settings: [
        { key: ESettingId.VercelTeamId, value: encode('') },
        { key: ESettingId.VercelProjectId, value: encode('prj_ok') },
      ],
    })

    const st = settings()
    const report = await run({
      resolution: resolutionFor({}),
      secrets: secrets(),
      settingsStore: st,
    })

    expect(report?.malformed).toContain(ESettingId.VercelTeamId)
    expect(report?.restored).toContain(ESettingId.VercelProjectId)
    expect(legacyRestoreMarkerExists({ file: markerFile })).toBe(true)
  })
})
