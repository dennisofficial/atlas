import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../../db'

const WRITER_ROLES = ['owner', 'admin']

@Injectable()
export class WorkspaceAccessService {
  async require(args: { userId: string; organizationId: string; write: boolean }): Promise<void> {
    const member = await db.member.findFirst({
      where: { organizationId: args.organizationId, userId: args.userId },
    })
    if (member === null) throw new NotFoundException('workspace not found')
    if (!args.write) return
    const roles = member.role.split(',').map((role) => role.trim())
    if (!roles.some((role) => WRITER_ROLES.includes(role))) {
      throw new ForbiddenException('only a workspace owner or admin can change this')
    }
  }
}
