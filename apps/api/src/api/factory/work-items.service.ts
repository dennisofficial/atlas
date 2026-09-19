import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { db } from '../../db'
import type { Prisma } from '../../generated/prisma/client'
import { EFactoryWorkItemStatus, type SurfaceAliasDto, type WorkItemDto } from './factory.types'
import { nextAliasId, nextWorkItemId, nowIso } from './ids'
import { toAliasDto, toWorkItemDto } from './rows'
import { isUniqueViolation } from './unique-violation'

@Injectable()
export class WorkItemsService {
  async intake(args: {
    repo: string
    sourceKind: string
    surface: string
    externalId: string
    aliasKind: string
  }): Promise<{ workItem: WorkItemDto; created: boolean }> {
    try {
      return await this.intakeOnce(args)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const existing = await this.resolve({
        surface: args.surface,
        externalId: args.externalId,
      })
      if (existing === null) {
        throw new Error('unique violation without a stored alias — the work-item store is inconsistent')
      }
      return { workItem: existing, created: false }
    }
  }

  private intakeOnce(args: {
    repo: string
    sourceKind: string
    surface: string
    externalId: string
    aliasKind: string
  }): Promise<{ workItem: WorkItemDto; created: boolean }> {
    return db.$transaction(async (tx) => {
      const existing = await tx.factorySurfaceAlias.findFirst({
        where: { surface: args.surface, externalId: args.externalId },
      })
      if (existing !== null) {
        const row = await tx.factoryWorkItem.findUniqueOrThrow({
          where: { id: existing.workItemId },
        })
        return { workItem: toWorkItemDto(row), created: false }
      }

      const at = nowIso()
      const row = await tx.factoryWorkItem.create({
        data: {
          id: nextWorkItemId(),
          repo: args.repo,
          sourceKind: args.sourceKind,
          status: EFactoryWorkItemStatus.Intake,
          lastActivityAt: at,
          createdAt: at,
          updatedAt: at,
        },
      })
      await tx.factorySurfaceAlias.create({
        data: {
          id: nextAliasId(),
          workItemId: row.id,
          surface: args.surface,
          externalId: args.externalId,
          kind: args.aliasKind,
          createdAt: at,
        },
      })
      return { workItem: toWorkItemDto(row), created: true }
    })
  }

  async resolve(args: { surface: string; externalId: string }): Promise<WorkItemDto | null> {
    const alias = await db.factorySurfaceAlias.findFirst({
      where: { surface: args.surface, externalId: args.externalId },
    })
    if (alias === null) return null
    const row = await db.factoryWorkItem.findUnique({ where: { id: alias.workItemId } })
    return row === null ? null : toWorkItemDto(row)
  }

  async find(args: { workItemId: string }): Promise<WorkItemDto> {
    const row = await db.factoryWorkItem.findUnique({ where: { id: args.workItemId } })
    if (row === null) throw new NotFoundException('unknown factory work item')
    return toWorkItemDto(row)
  }

  async registerAlias(args: {
    workItemId: string
    surface: string
    externalId: string
    kind: string
  }): Promise<SurfaceAliasDto> {
    await this.find({ workItemId: args.workItemId })
    try {
      return await this.registerAliasOnce(args)
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const existing = await db.factorySurfaceAlias.findFirst({
        where: { surface: args.surface, externalId: args.externalId },
      })
      if (existing === null) {
        throw new Error('unique violation without a stored alias — the work-item store is inconsistent')
      }
      if (existing.workItemId !== args.workItemId) {
        throw new ConflictException('surface is already aliased to another work item')
      }
      return toAliasDto(existing)
    }
  }

  private async registerAliasOnce(args: {
    workItemId: string
    surface: string
    externalId: string
    kind: string
  }): Promise<SurfaceAliasDto> {
    const existing = await db.factorySurfaceAlias.findFirst({
      where: { surface: args.surface, externalId: args.externalId },
    })
    if (existing !== null) {
      if (existing.workItemId !== args.workItemId) {
        throw new ConflictException('surface is already aliased to another work item')
      }
      return toAliasDto(existing)
    }
    const row = await db.factorySurfaceAlias.create({
      data: {
        id: nextAliasId(),
        workItemId: args.workItemId,
        surface: args.surface,
        externalId: args.externalId,
        kind: args.kind,
        createdAt: nowIso(),
      },
    })
    return toAliasDto(row)
  }

  async attachOrchestrator(args: { workItemId: string; threadId: string }): Promise<void> {
    await this.touch({ workItemId: args.workItemId, data: { orchestratorThreadId: args.threadId } })
  }

  async attachDrive(args: { workItemId: string; driveName: string }): Promise<void> {
    await this.touch({ workItemId: args.workItemId, data: { driveName: args.driveName } })
  }

  async transition(args: {
    workItemId: string
    status: EFactoryWorkItemStatus
  }): Promise<WorkItemDto> {
    return this.touch({ workItemId: args.workItemId, data: { status: args.status } })
  }

  async countRevision(args: { workItemId: string }): Promise<WorkItemDto> {
    return this.touch({ workItemId: args.workItemId, data: { revisionCycles: { increment: 1 } } })
  }

  private async touch(args: {
    workItemId: string
    data: Prisma.FactoryWorkItemUpdateInput
  }): Promise<WorkItemDto> {
    const at = nowIso()
    const row = await db.factoryWorkItem.update({
      where: { id: args.workItemId },
      data: { ...args.data, lastActivityAt: at, updatedAt: at },
    })
    return toWorkItemDto(row)
  }
}
