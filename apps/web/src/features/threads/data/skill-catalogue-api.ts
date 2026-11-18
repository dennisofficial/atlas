import { skillCatalogueReplySchema } from '@dltech/atlas-wire/web'

import { api, cloudCall } from '@/lib/api-client'

export const fetchSkillCatalogue = async () =>
  skillCatalogueReplySchema.parse(await cloudCall(api.skillCatalogue.list.query({})))
