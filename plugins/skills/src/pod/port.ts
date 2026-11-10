export type SkillScopeName = 'user' | 'project'

export type CloudSkillEntry = { name: string; description: string; scope: SkillScopeName }

export type CloudSkillText = { scope: SkillScopeName; name: string; text: string }

export type CloudSkillBody = { text: string; revision: number; hash: string }

export type CloudSkillSource = {
  entries(): readonly CloudSkillEntry[]
  frontmatter(): Promise<readonly CloudSkillText[]>
  body(entry: CloudSkillEntry): Promise<CloudSkillBody | null>
  file(entry: CloudSkillEntry, path: string): Promise<CloudSkillBody | null>
}

export type CloudSkillWriteRequest = {
  scope: SkillScopeName
  name: string
  path: string
  body: string
  description: string | null
  baseRevision: number | null
}

export type CloudSkillRevision = { revision: number; hash: string }

export type CloudSkillWriteResult =
  | { ok: true; revision: number }
  | { ok: false; reason: string; current: CloudSkillRevision | null }

export type CloudSkillWriter = {
  write(request: CloudSkillWriteRequest): Promise<CloudSkillWriteResult>
  remove(request: { scope: SkillScopeName; name: string }): Promise<CloudSkillWriteResult>
}
