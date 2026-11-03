import { Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'

export abstract class V2ProjectAccess {
  abstract ownerOf(args: { projectId: string }): Promise<string | undefined>
}

@Injectable()
export class DbV2ProjectAccess extends V2ProjectAccess {
  async ownerOf(args: { projectId: string }): Promise<string | undefined> {
    const project = await db.orm.public.Project.select('id', 'ownerUserId').first({
      id: args.projectId,
    })
    return project?.ownerUserId ?? undefined
  }
}
