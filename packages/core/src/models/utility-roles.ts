import { ESettingId } from '../settings/registry'

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
