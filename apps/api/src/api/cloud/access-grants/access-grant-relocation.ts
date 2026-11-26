import {
  EAccessMemberKind,
  EAccessScope,
  type AccessGrantRelocate,
  type AccessScope,
} from '@dltech/atlas-wire'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { GroupsService } from '../project-groups/project-groups.service'
import { ProjectsService } from '../projects/projects.service'
import { withGrantNameConflict } from './access-grant-membership'
import {
  type AccessGrantTables,
  groupGrantTables,
  personalGrantTables,
  projectGrantTables,
  type RelocatedMember,
  type TakenMembers,
} from './access-grant-relocation-layers'

const GRANT_NOT_FOUND = 'access grant not found'
const GRANT_NAME_TAKEN = 'a grant with that name already exists there'

const scopeKeyOf = (scope: AccessScope): string => {
  if (scope.kind === EAccessScope.Personal) return EAccessScope.Personal
  if (scope.kind === EAccessScope.Group) return `${scope.kind}:${scope.groupId}`
  return `${scope.kind}:${scope.projectId}`
}

const clashesOf = (args: {
  members: readonly RelocatedMember[]
  taken: TakenMembers
}): readonly string[] => {
  const secretNames = new Set(args.taken.secrets)
  const filePaths = new Set(args.taken.files)
  return args.members
    .filter((member) =>
      member.kind === EAccessMemberKind.Secret
        ? secretNames.has(member.name)
        : filePaths.has(member.path),
    )
    .map((member) => (member.kind === EAccessMemberKind.Secret ? member.name : member.path))
}

const badPathsOf = (args: {
  members: readonly RelocatedMember[]
  tables: AccessGrantTables
}): readonly string[] =>
  args.members
    .filter((member) => member.kind === EAccessMemberKind.File)
    .map((member) => {
      const problem = args.tables.pathProblem(member.path)
      return problem === null ? null : `${member.path} (${problem})`
    })
    .filter((entry): entry is string => entry !== null)

@Injectable()
export class RelocateAccessGrantsService {
  constructor(
    private readonly projects: ProjectsService,
    private readonly groups: GroupsService,
  ) {}

  async move(args: { userId: string; input: AccessGrantRelocate }): Promise<{ id: string }> {
    const { scope, target, id } = args.input
    const source = await this.tablesOf({ userId: args.userId, scope })
    const destination = await this.tablesOf({ userId: args.userId, scope: target })
    if (scopeKeyOf(scope) === scopeKeyOf(target)) {
      throw new BadRequestException('the grant is already in that layer')
    }
    return db.transaction(async (tx) => {
      const grant = await source.grantOf({ tx, id })
      if (grant === null) throw new NotFoundException(GRANT_NOT_FOUND)
      const clash = await destination.grantNamed({ tx, name: grant.name })
      if (clash !== null) throw new ConflictException(GRANT_NAME_TAKEN)
      const members = await source.membersOf({ tx, grantId: grant.id })
      const clashes = clashesOf({ members, taken: await destination.takenMembers({ tx }) })
      if (clashes.length > 0) {
        throw new ConflictException(`that layer already has ${clashes.join(', ')}`)
      }
      const badPaths = badPathsOf({ members, tables: destination })
      if (badPaths.length > 0) {
        throw new BadRequestException(`these file paths cannot move there: ${badPaths.join(', ')}`)
      }
      const createdId = await withGrantNameConflict(() =>
        destination.createGrant({
          tx,
          name: grant.name,
          instruction: grant.instruction,
        }),
      )
      for (const member of members) {
        await destination.addMember({ tx, grantId: createdId, member })
      }
      await source.deleteGrant({ tx, id: grant.id })
      return { id: createdId }
    })
  }

  private async tablesOf(args: { userId: string; scope: AccessScope }): Promise<AccessGrantTables> {
    if (args.scope.kind === EAccessScope.Personal) return personalGrantTables(args.userId)
    if (args.scope.kind === EAccessScope.Group) {
      await this.groups.owned({ userId: args.userId, groupId: args.scope.groupId })
      return groupGrantTables(args.scope.groupId)
    }
    await this.projects.read({ userId: args.userId, projectId: args.scope.projectId })
    return projectGrantTables(args.scope.projectId)
  }
}
