import { contractStorageHash, databaseErrorCode, db } from '@dltech/atlas-db'
import { Injectable } from '@nestjs/common'
import { contractDrift, EContractDrift, shippedMigrationGraph } from '../../../_lib/migrations/contract-drift'

export enum EMigrationState {
  Level = 'level',
  Behind = 'behind',
  Unknown = 'unknown',
}

export type MigrationReport = {
  state: EMigrationState
  pending: readonly string[]
}

const UNDEFINED_TABLE = '42P01'

@Injectable()
export class MigrationStateService {
  private level = false

  async report(): Promise<MigrationReport> {
    if (this.level) return { state: EMigrationState.Level, pending: [] }

    const marker = await this.markerHash()
    if (marker === undefined) return { state: EMigrationState.Unknown, pending: [] }

    const drift = contractDrift({ expected: contractStorageHash, marker, graph: shippedMigrationGraph() })
    if (drift === EContractDrift.Behind) {
      return { state: EMigrationState.Behind, pending: [`contract ${contractStorageHash}`] }
    }

    this.level = true
    return { state: EMigrationState.Level, pending: [] }
  }

  private async markerHash(): Promise<string | null | undefined> {
    try {
      const statement = db.raw.sql`SELECT core_hash FROM prisma_contract.marker WHERE space = 'app'`
        .returnsRow({ core_hash: 'pg/text@1' })
        .build()
      const rows = await db.query(statement)
      return rows[0]?.core_hash ?? null
    } catch (cause) {
      return databaseErrorCode(cause) === UNDEFINED_TABLE ? null : undefined
    }
  }
}
