'use client'

import { useCallback, useMemo } from 'react'
import { z } from 'zod'

import {
  CLOUD_SETTING_REGISTRY,
  decodeSettingValue,
  encodeSettingValue,
  WORKSPACE_SETTING_REGISTRY,
  type CloudSettingEntry,
  type SettingScalar,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from './api-client'
import { cloudJson, cloudSend, EHttpMethod } from './cloud-api'
import { useCloudQuery, type CloudQuery } from './use-cloud-query'

export enum ESettingsTarget {
  Personal = 'personal',
  Workspace = 'workspace',
}

export type SettingsTarget =
  | { kind: ESettingsTarget.Personal }
  | { kind: ESettingsTarget.Workspace; organizationId: string }

export type SettingValues = ReadonlyMap<string, SettingScalar>
export type SettingChanges = Record<string, SettingScalar | null>

const settingListSchema = z.object({
  settings: z.array(z.object({ key: z.string(), value: z.string(), updatedAt: z.string() })),
})

const PERSONAL_SETTINGS_PATH = '/v1/settings'

const registryOf = (target: SettingsTarget): ReadonlyMap<string, CloudSettingEntry> =>
  target.kind === ESettingsTarget.Personal ? CLOUD_SETTING_REGISTRY : WORKSPACE_SETTING_REGISTRY

export async function fetchSettings(target: SettingsTarget): Promise<SettingValues> {
  const body =
    target.kind === ESettingsTarget.Personal
      ? await cloudJson({
          method: EHttpMethod.Get,
          path: PERSONAL_SETTINGS_PATH,
          schema: settingListSchema,
        })
      : await cloudCall(
          api.workspaces.listSettings.query({ organizationId: target.organizationId }),
        )
  return new Map(body.settings.map((setting) => [setting.key, decodeSettingValue(setting.value)]))
}

export async function saveSettings(args: {
  target: SettingsTarget
  changes: SettingChanges
}): Promise<void> {
  const values: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(args.changes)) {
    values[key] = value === null ? null : encodeSettingValue(value)
  }
  if (Object.keys(values).length === 0) return
  const { target } = args
  if (target.kind === ESettingsTarget.Personal) {
    await cloudSend({ method: EHttpMethod.Patch, path: PERSONAL_SETTINGS_PATH, body: { values } })
    return
  }
  await cloudCall(
    api.workspaces.patchSettings.mutate({ organizationId: target.organizationId, values }),
  )
}

export function resolveSetting<TValue extends SettingScalar>(args: {
  target: SettingsTarget
  values: SettingValues
  key: string
  schema: z.ZodType<TValue>
}): TValue {
  const entry = registryOf(args.target).get(args.key)
  if (entry === undefined) throw new Error(`setting ${args.key} is not in the registry`)
  const stored = args.schema.safeParse(args.values.get(args.key))
  if (stored.success) return stored.data
  return args.schema.parse(entry.fallback)
}

export type CloudSettings = {
  query: CloudQuery<SettingValues>
  read: <TValue extends SettingScalar>(args: { key: string; schema: z.ZodType<TValue> }) => TValue
  save: (changes: SettingChanges) => Promise<void>
}

export function useCloudSettings(target: SettingsTarget): CloudSettings {
  const organizationId = target.kind === ESettingsTarget.Workspace ? target.organizationId : null
  const targetKey = organizationId === null ? 'personal' : `ws:${organizationId}`
  const stableTarget = useMemo<SettingsTarget>(
    () =>
      organizationId === null
        ? { kind: ESettingsTarget.Personal }
        : { kind: ESettingsTarget.Workspace, organizationId },
    [organizationId],
  )
  const load = useCallback(() => fetchSettings(stableTarget), [stableTarget])
  const query = useCloudQuery({ key: `settings:${targetKey}`, load })

  const read = useCallback(
    <TValue extends SettingScalar>(args: { key: string; schema: z.ZodType<TValue> }): TValue =>
      resolveSetting({ target: stableTarget, values: query.data ?? new Map(), ...args }),
    [stableTarget, query.data],
  )

  const { reload } = query
  const save = useCallback(
    async (changes: SettingChanges) => {
      await saveSettings({ target: stableTarget, changes })
      reload()
    },
    [stableTarget, reload],
  )

  return { query, read, save }
}
