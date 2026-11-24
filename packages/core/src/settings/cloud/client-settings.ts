import { z } from 'zod'

import type { SettingDefinition } from '../definition'
import { ATLAS_SETTINGS, ESettingId } from '../registry'
import { ESettingKind } from '../value'
import type { SettingScalar } from './setting-codec'
import { ESettingConsumer, settingEntry, type CloudSettingEntry } from './setting-entry'

export const CLIENT_SETTING_IDS: readonly ESettingId[] = [
  ESettingId.ImageRows,
  ESettingId.FenceWrap,
  ESettingId.SidebarWidth,
  ESettingId.Accent,
  ESettingId.BlockPadding,
  ESettingId.ComposerEdge,
  ESettingId.Logo,
]

const CLIENT_SETTING_ID_SET: ReadonlySet<string> = new Set(CLIENT_SETTING_IDS)

export const isClientSettingId = (id: string): boolean => CLIENT_SETTING_ID_SET.has(id)

export const schemaForDefinition = (definition: SettingDefinition): z.ZodType<SettingScalar> => {
  if (definition.kind === ESettingKind.Toggle) return z.boolean()
  if (definition.kind === ESettingKind.Choice)
    return z.enum(definition.options.map((option) => option.value) as [string, ...string[]])
  if (definition.kind === ESettingKind.Range)
    return z.number().int().min(definition.minimum).max(definition.maximum)
  if (definition.kind === ESettingKind.Text) return z.string()
  if (definition.kind === ESettingKind.Model) return z.string()
  if (definition.kind === ESettingKind.Secret) return z.string()
  throw new Error('a setting kind the client registry cannot validate')
}

export const definitionOf = (id: ESettingId): SettingDefinition => {
  const found = ATLAS_SETTINGS.find((definition) => definition.id === id)
  if (found === undefined) throw new Error(`setting ${id} has no definition`)
  return found
}

export const CLIENT_SETTING_ENTRIES: readonly [string, CloudSettingEntry][] =
  CLIENT_SETTING_IDS.map((id) => {
    const definition = definitionOf(id)
    return settingEntry({
      key: id,
      schema: schemaForDefinition(definition),
      fallback: definition.fallback,
      consumer: ESettingConsumer.None,
    })
  })
