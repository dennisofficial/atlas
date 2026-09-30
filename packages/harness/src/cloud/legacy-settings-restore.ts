import { existsSync, writeFileSync } from 'node:fs'

import {
  ESettingId,
  type SettingsResolution,
  type SettingsStorePort,
} from '@dltech/atlas-core'

import type { FileSecretsStore } from '../secrets/file-secrets-store'
import { CloudClient } from './cloud-client'
import type { CloudSession } from './cloud-session'
import { decodeSettingValue } from './sync-settings'

export type LegacyRestoreReport = {
  outcome: 'restored' | 'unreachable' | 'incomplete'
  restored: string[]
  malformed: string[]
}

export type LegacyRestore = {
  promise: Promise<LegacyRestoreReport | undefined>
}

const MISSING_SETTINGS: readonly ESettingId[] = [
  ESettingId.VercelTeamId,
  ESettingId.VercelProjectId,
  ESettingId.SandboxImage,
]

const empty = (value: unknown): boolean =>
  typeof value !== 'string' || value.trim().length === 0

export function legacyRestoreMarkerExists(args: { file: string }): boolean {
  return existsSync(args.file)
}

export function restoreLegacySandboxConfiguration(args: {
  session: CloudSession
  resolution: SettingsResolution
  secrets: FileSecretsStore
  settingsStore?: SettingsStorePort | undefined
  markerFile: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
}): LegacyRestore {
  return { promise: run(args) }
}

async function run(args: {
  session: CloudSession
  resolution: SettingsResolution
  secrets: FileSecretsStore
  settingsStore?: SettingsStorePort | undefined
  markerFile: string
  clientVersion: string
  fetchFn?: typeof fetch | undefined
}): Promise<LegacyRestoreReport | undefined> {
  const tokenMissing = empty(args.secrets.read(ESettingId.VercelToken))
  const missingSettings = MISSING_SETTINGS.filter((id) => {
    const held = args.resolution.settings.get(id)
    if (held !== undefined && held.layer !== 'default') return false
    return empty(args.resolution.settings.get(id)?.value)
  })
  if (!tokenMissing && missingSettings.length === 0) return undefined
  if (missingSettings.length > 0 && args.settingsStore === undefined) return undefined

  const client = new CloudClient({
    url: args.session.url,
    token: args.session.token,
    clientVersion: args.clientVersion,
    ...(args.fetchFn === undefined ? {} : { fetchFn: args.fetchFn }),
  })

  let remoteSecrets: { name: string; value: string }[]
  let remoteSettings: { key: string; value: string }[]
  try {
    remoteSecrets = tokenMissing
      ? [...(await client.listSecrets())]
      : []
    remoteSettings = [...(await client.listSettings())]
  } catch {
    return { outcome: 'unreachable', restored: [], malformed: [] }
  }

  const secretMap = new Map(remoteSecrets.map((row) => [row.name, row.value]))
  const settingMap = new Map(
    remoteSettings.map((row) => [row.key, decodeSettingValue(row.value)]),
  )

  const restored: string[] = []
  const malformed: string[] = []
  let wrote = false

  if (tokenMissing) {
    const value = secretMap.get(ESettingId.VercelToken)
    if (value !== undefined && !empty(value)) {
      args.secrets.write({ name: ESettingId.VercelToken, value })
      restored.push('Vercel token')
      wrote = true
    }
  }

  const store = args.settingsStore
  if (store !== undefined) {
    for (const id of missingSettings) {
      const value = settingMap.get(id)
      if (value === undefined) continue
      if (typeof value === 'string' && !empty(value)) {
        const document = store.read().document
        store.write({ values: { ...document.values, [id]: value } })
        restored.push(id)
        wrote = true
      } else {
        malformed.push(id)
      }
    }
  }

  if (wrote) {
    writeFileSync(args.markerFile, new Date().toISOString(), { mode: 0o600 })
  }

  if (malformed.length > 0 || restored.length === 0) {
    return { outcome: 'incomplete', restored, malformed }
  }
  return { outcome: 'restored', restored, malformed }
}
