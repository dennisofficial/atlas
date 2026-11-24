export enum EOnboardingRow {
  Accounts = 'accounts',
  Default = 'default',
  Quick = 'quick',
  Compaction = 'compaction',
  Subagents = 'subagents',
  Begin = 'begin',
}

export type OnboardingRowView = {
  key: EOnboardingRow
  label: string
  value: string
  done: boolean
}
