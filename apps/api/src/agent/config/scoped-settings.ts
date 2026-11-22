import type { Db } from '@dltech/atlas-db'

export async function scopedSettingsOf(args: {
  db: Db
  userId: string
  projectId: string | null
}): Promise<ReadonlyMap<string, string>> {
  const user = await args.db.orm.public.UserSetting.where({ userId: args.userId }).all()
  const settings = new Map(user.map((row) => [row.key, row.value]))
  if (args.projectId === null) return settings
  const project = await args.db.orm.public.ProjectSetting.where({ projectId: args.projectId }).all()
  for (const row of project) settings.set(row.key, row.value)
  return settings
}
