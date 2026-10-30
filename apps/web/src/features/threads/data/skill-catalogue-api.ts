import { skillCatalogueReplySchema } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export const fetchSkillCatalogue = async (projectId: string | null | undefined) =>
  skillCatalogueReplySchema.parse(
    await cloudCall(api.skillCatalogue.list.query(projectId ? { projectId } : {})),
  )
