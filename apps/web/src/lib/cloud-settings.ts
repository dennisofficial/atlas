'use client'

import { useCallback } from 'react'
import { z } from 'zod'

import {
  CLOUD_SETTING_REGISTRY,
  decodeSettingValue,
  encodeSettingValue,
  type SettingScalar,
} from '@dltech/atlas-wire/web'

import { api, cloudCall } from './api-client'
import { useCloudQuery, type CloudQuery } from './use-cloud-query'

export type SettingValues = ReadonlyMap<string, SettingScalar>
export type SettingChanges = Record<string, SettingScalar | null>

export async function fetchSettings(): Promise<SettingValues> {
  const body = await cloudCall(api.settings.list.query())
  return new Map(body.settings.map((setting) => [setting.key, decodeSettingValue(setting.value)]))
}

export async function saveSettings(changes: SettingChanges): Promise<void> {
  const values: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(changes)) {
    values[key] = value === null ? null : encodeSettingValue(value)
  }
  if (Object.keys(values).length === 0) return
  await cloudCall(api.settings.patch.mutate({ values }))
}

export function resolveSetting<TValue extends SettingScalar>(args: {
  values: SettingValues
  key: string
  schema: z.ZodType<TValue>
}): TValue {
  const entry = CLOUD_SETTING_REGISTRY.get(args.key)
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

export function useCloudSettings(): CloudSettings {
  const query = useCloudQuery({ key: 'settings:personal', load: fetchSettings })

  const read = useCallback(
    <TValue extends SettingScalar>(args: { key: string; schema: z.ZodType<TValue> }): TValue =>
      resolveSetting({ values: query.data ?? new Map(), ...args }),
    [query.data],
  )

  const { reload } = query
  const save = useCallback(
    async (changes: SettingChanges) => {
      await saveSettings(changes)
      reload()
    },
    [reload],
  )

  return { query, read, save }
}
