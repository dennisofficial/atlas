import { EProjectSettingsSection } from './project-sections'

export enum EGroupSettingsSection {
  Instructions = 'instructions',
}

export type TGroupSection =
  | Exclude<EProjectSettingsSection, EProjectSettingsSection.PullRequests>
  | EGroupSettingsSection

export type IGroupSectionItem = {
  section: TGroupSection
  label: string
}

export const GROUP_SECTIONS: readonly IGroupSectionItem[] = [
  { section: EProjectSettingsSection.Overview, label: 'Overview' },
  { section: EGroupSettingsSection.Instructions, label: 'Instructions' },
  { section: EProjectSettingsSection.Sandbox, label: 'Sandbox' },
  { section: EProjectSettingsSection.Access, label: 'Access' },
  { section: EProjectSettingsSection.Skills, label: 'Skills' },
  { section: EProjectSettingsSection.Mcp, label: 'MCP' },
]
