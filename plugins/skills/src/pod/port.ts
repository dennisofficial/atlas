export type SkillScopeName = 'user' | 'project'

export type CloudSkillEntry = { name: string; description: string; scope: SkillScopeName }

export type CloudSkillSource = {
  entries(): readonly CloudSkillEntry[]
  text(entry: CloudSkillEntry): Promise<string | null>
  file(entry: CloudSkillEntry, path: string): Promise<string | null>
}
