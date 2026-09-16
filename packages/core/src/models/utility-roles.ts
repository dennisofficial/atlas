import { ESettingId } from '../settings/registry'
import { findCard, type ModelCatalog } from './card'
import { EEffort } from './effort-ladder'
import { parseRef, type ModelRef } from './ref'

export enum EUtilityModelRole {
  Tldr = 'tldr',
  Titler = 'titler',
  Judge = 'judge',
  Compaction = 'compaction',
}

export const UTILITY_ROLE_LABEL: Readonly<Record<EUtilityModelRole, string>> = {
  [EUtilityModelRole.Tldr]: 'tl;dr footer',
  [EUtilityModelRole.Titler]: 'session titler',
  [EUtilityModelRole.Judge]: 'judge',
  [EUtilityModelRole.Compaction]: 'compaction',
}

export const utilitySettingFor = (role: EUtilityModelRole): ESettingId =>
  role === EUtilityModelRole.Compaction ? ESettingId.CompactionModel : ESettingId.QuickModel

export const UTILITY_ROLE_EFFORT: Readonly<Record<EUtilityModelRole, EEffort>> = {
  [EUtilityModelRole.Tldr]: EEffort.Low,
  [EUtilityModelRole.Titler]: EEffort.Low,
  [EUtilityModelRole.Judge]: EEffort.Low,
  [EUtilityModelRole.Compaction]: EEffort.Medium,
}

/**
 * A role with no override of its own follows the default model rather than pinning one of its own:
 * there is no built-in model id to fall back to, because no provider can be assumed set up.
 */
export function resolveUtilityModel(args: {
  role: EUtilityModelRole
  override: string
  followDefault: ModelRef
  catalogue: ModelCatalog
}): ModelRef {
  const parsed = parseRef(args.override)
  if (parsed !== undefined && findCard({ catalog: args.catalogue, ref: parsed }) !== undefined) {
    return parsed
  }

  return args.followDefault
}
