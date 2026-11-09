export type SkillScopeName = 'user' | 'project'

export type CloudSkillEntry = { name: string; description: string; scope: SkillScopeName }

export type CloudSkillText = { scope: SkillScopeName; name: string; text: string }

export type CloudSkillSource = {
  entries(): readonly CloudSkillEntry[]
  frontmatter(): Promise<readonly CloudSkillText[]>
  text(entry: CloudSkillEntry): Promise<string | null>
  file(entry: CloudSkillEntry, path: string): Promise<string | null>
}
