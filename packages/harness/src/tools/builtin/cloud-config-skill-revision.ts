import type { ApiClient } from '@dltech/atlas-api-router'
import type { ESkillScope } from '@dltech/atlas-wire'

import { cloudCall } from '../../cloud/api-trpc-client'

export type SkillScope =
  | { scope: ESkillScope.Personal }
  | { scope: ESkillScope.Project; projectId: string }

export const currentSkillFileRevision = async (args: {
  client: ApiClient
  scope: SkillScope
  skill: string
  file: string
}): Promise<number> => {
  const body = await cloudCall(
    args.client.skills.listFiles.query({ ...args.scope, skill: args.skill }),
    { allowMissing: true },
  )
  return body?.files.find((row) => row.path === args.file)?.revision ?? 0
}
