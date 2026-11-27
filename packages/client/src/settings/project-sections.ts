export enum EProjectSettingsSection {
  Overview = 'overview',
  Sandbox = 'sandbox',
  Access = 'access',
  Skills = 'skills',
  Mcp = 'mcp',
  PullRequests = 'pull-requests',
}

export type IProjectSectionItem = {
  section: EProjectSettingsSection
  label: string
}

export const PROJECT_SECTIONS: readonly IProjectSectionItem[] = [
  { section: EProjectSettingsSection.Overview, label: 'Overview' },
  { section: EProjectSettingsSection.Sandbox, label: 'Sandbox' },
  { section: EProjectSettingsSection.Access, label: 'Access' },
  { section: EProjectSettingsSection.Skills, label: 'Skills' },
  { section: EProjectSettingsSection.Mcp, label: 'MCP' },
  { section: EProjectSettingsSection.PullRequests, label: 'Pull requests' },
]
