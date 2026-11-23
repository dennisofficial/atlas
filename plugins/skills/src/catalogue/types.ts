export type BuiltInSkillFileEntry = {
  path: string
  digest: string
  sizeBytes: number
  isText: boolean
}

export type BuiltInSkillCatalogueEntry = {
  name: string
  description: string
  updatedAt: string
  entry: { path: string; digest: string; sizeBytes: number }
  files: readonly BuiltInSkillFileEntry[]
}
