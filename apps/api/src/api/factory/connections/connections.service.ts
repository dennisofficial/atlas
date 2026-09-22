import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import type { EFactoryConnectionProvider, FactoryConnectionDto } from '../factory.types'
import { toConnectionDto } from '../rows'

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
}
