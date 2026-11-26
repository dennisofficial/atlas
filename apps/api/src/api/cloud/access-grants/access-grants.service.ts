import {
  EAccessScope,
  type AccessGrant,
  type AccessGrantMove,
  type AccessGrantRelocate,
  type AccessGrantSave,
  type AccessGrantLayeredList,
  type AccessScope,
} from '@dltech/atlas-wire'
import { Injectable } from '@nestjs/common'
import { GroupAccessGrantsService } from './group-access-grants.service'
import { LayeredAccessGrantsService } from './layered-access-grants.service'
import { PersonalAccessGrantsService } from './personal-access-grants.service'
import { ProjectAccessGrantsService } from './project-access-grants.service'
import { RelocateAccessGrantsService } from './access-grant-relocation'

@Injectable()
export class AccessGrantsService {
  constructor(
    private readonly personal: PersonalAccessGrantsService,
    private readonly group: GroupAccessGrantsService,
    private readonly project: ProjectAccessGrantsService,
    private readonly layered: LayeredAccessGrantsService,
    private readonly relocate: RelocateAccessGrantsService,
  ) {}

  list(args: { userId: string; scope: AccessScope }): Promise<AccessGrant[]> {
    if (args.scope.kind === EAccessScope.Personal) return this.personal.list(args.userId)
    if (args.scope.kind === EAccessScope.Group) {
      return this.group.list({ userId: args.userId, groupId: args.scope.groupId })
    }
    return this.project.list({ userId: args.userId, projectId: args.scope.projectId })
  }

  layers(args: { userId: string; scope: AccessScope }): Promise<AccessGrantLayeredList> {
    return this.layered.layered({ userId: args.userId, scope: args.scope })
  }

  save(args: { userId: string; input: AccessGrantSave }): Promise<{ id: string }> {
    if (args.input.scope.kind === EAccessScope.Personal) return this.personal.save(args)
    if (args.input.scope.kind === EAccessScope.Group) {
      return this.group.save({
        userId: args.userId,
        groupId: args.input.scope.groupId,
        input: args.input,
      })
    }
    const projectId = args.input.scope.projectId
    return this.project.save({ userId: args.userId, projectId, input: args.input })
  }

  remove(args: { userId: string; scope: AccessScope; id: string }): Promise<void> {
    if (args.scope.kind === EAccessScope.Personal) {
      return this.personal.remove({ userId: args.userId, id: args.id })
    }
    if (args.scope.kind === EAccessScope.Group) {
      return this.group.remove({
        userId: args.userId,
        groupId: args.scope.groupId,
        id: args.id,
      })
    }
    return this.project.remove({
      userId: args.userId,
      projectId: args.scope.projectId,
      id: args.id,
    })
  }

  moveMember(args: { userId: string; input: AccessGrantMove }): Promise<void> {
    if (args.input.scope.kind === EAccessScope.Personal) return this.personal.moveMember(args)
    if (args.input.scope.kind === EAccessScope.Group) {
      return this.group.moveMember({
        userId: args.userId,
        groupId: args.input.scope.groupId,
        input: args.input,
      })
    }
    return this.project.moveMember({
      userId: args.userId,
      projectId: args.input.scope.projectId,
      input: args.input,
    })
  }

  moveGrant(args: { userId: string; input: AccessGrantRelocate }): Promise<{ id: string }> {
    return this.relocate.move(args)
  }
}
