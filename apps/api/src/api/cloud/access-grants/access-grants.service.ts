import {
  EAccessScope,
  type AccessGrant,
  type AccessGrantMove,
  type AccessGrantSave,
  type AccessScope,
} from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { PersonalAccessGrantsService } from './personal-access-grants.service'
import { ProjectAccessGrantsService } from './project-access-grants.service'

@Injectable()
export class AccessGrantsService {
  constructor(
    private readonly personal: PersonalAccessGrantsService,
    private readonly project: ProjectAccessGrantsService,
  ) {}

  list(args: { userId: string; scope: AccessScope }): Promise<AccessGrant[]> {
    if (args.scope.kind === EAccessScope.Personal) return this.personal.list(args.userId)
    return this.project.list({ userId: args.userId, projectId: args.scope.projectId })
  }

  save(args: { userId: string; input: AccessGrantSave }): Promise<{ id: string }> {
    if (args.input.scope.kind === EAccessScope.Personal) return this.personal.save(args)
    const projectId = args.input.scope.projectId
    return this.project.save({ userId: args.userId, projectId, input: args.input })
  }

  remove(args: { userId: string; scope: AccessScope; id: string }): Promise<void> {
    if (args.scope.kind === EAccessScope.Personal) {
      return this.personal.remove({ userId: args.userId, id: args.id })
    }
    return this.project.remove({
      userId: args.userId,
      projectId: args.scope.projectId,
      id: args.id,
    })
  }

  moveMember(args: { userId: string; input: AccessGrantMove }): Promise<void> {
    if (args.input.scope.kind === EAccessScope.Personal) return this.personal.moveMember(args)
    return this.project.moveMember({
      userId: args.userId,
      projectId: args.input.scope.projectId,
      input: args.input,
    })
  }
}
