import { BadRequestException, Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { GROUP_INSTRUCTION_CHAR_LIMIT, type GroupInstruction } from '@dltech/atlas-wire'
import { GroupsService } from './project-groups.service'

type Scope = { userId: string; groupId: string }

@Injectable()
export class GroupInstructionsService {
  constructor(private readonly groups: GroupsService) {}

  async read(args: Scope): Promise<GroupInstruction> {
    await this.groups.owned(args)
    const row = await db.orm.public.GroupInstruction.where({ groupId: args.groupId }).first()
    return { content: row?.content ?? '', updatedAt: row?.updatedAt.toISOString() ?? null }
  }

  async save(args: Scope & { content: string }): Promise<void> {
    await this.groups.owned(args)
    if (args.content.length > GROUP_INSTRUCTION_CHAR_LIMIT) {
      throw new BadRequestException(
        `group instructions are at most ${GROUP_INSTRUCTION_CHAR_LIMIT} characters`,
      )
    }
    const { groupId } = args
    await db.orm.public.GroupInstruction.upsert({
      conflictOn: { groupId },
      create: { groupId, content: args.content },
      update: { content: args.content },
    })
  }
}
