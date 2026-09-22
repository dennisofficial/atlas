import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import type { EFactoryConnectionProvider, FactoryConnectionDto } from '../factory.types'
import { nextConnectionId, nowIso } from '../ids'
import { toConnectionDto } from '../rows'
import { inconsistentStore, isUniqueViolation } from '../unique-violation'

const CONNECTION_UNIQUE_TARGET = ['provider', 'externalAccountId'] as const

@Injectable()
export class FactoryConnectionsService {
  async resolve(args: {
    provider: EFactoryConnectionProvider
    externalAccountId: string
  }): Promise<FactoryConnectionDto | null> {
    const row = await db.factoryConnection.findFirst({
      where: { provider: args.provider, externalAccountId: args.externalAccountId },
    })
    return row === null ? null : toConnectionDto(row)
  }

  async upsert(args: {
    provider: EFactoryConnectionProvider
    externalAccountId: string
    organizationId: string
    status: string
  }): Promise<FactoryConnectionDto> {
    const existing = await this.resolve({
      provider: args.provider,
      externalAccountId: args.externalAccountId,
    })
    if (existing !== null) return this.repoint({ id: existing.id, args })

    const at = nowIso()
    try {
      const row = await db.factoryConnection.create({
        data: {
          id: nextConnectionId(),
          organizationId: args.organizationId,
          provider: args.provider,
          externalAccountId: args.externalAccountId,
          status: args.status,
          createdAt: at,
          updatedAt: at,
        },
      })
      return toConnectionDto(row)
    } catch (error) {
      if (!isUniqueViolation(error, CONNECTION_UNIQUE_TARGET)) throw error
      const raced = await this.resolve({
        provider: args.provider,
        externalAccountId: args.externalAccountId,
      })
      if (raced === null) throw inconsistentStore('connection')
      return this.repoint({ id: raced.id, args })
    }
  }

  private async repoint(args: {
    id: string
    args: { organizationId: string; status: string }
  }): Promise<FactoryConnectionDto> {
    const row = await db.factoryConnection.update({
      where: { id: args.id },
      data: {
        organizationId: args.args.organizationId,
        status: args.args.status,
        updatedAt: nowIso(),
      },
    })
    return toConnectionDto(row)
  }
}
