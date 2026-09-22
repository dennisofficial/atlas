import { Injectable } from '@nestjs/common'
import { db } from '../../../db'
import { pendingMigrations, shippedMigrationNames } from '../../../_lib/migrations/pending-migrations'

export enum EMigrationState {
  Level = 'level',
  Behind = 'behind',
  Unknown = 'unknown',
}

export type MigrationReport = {
  state: EMigrationState
  pending: readonly string[]
}

type AppliedRow = { migration_name: string }

@Injectable()
export class MigrationStateService {
  private level = false

  async report(): Promise<MigrationReport> {
    if (this.level) return { state: EMigrationState.Level, pending: [] }

    const applied = await this.appliedNames()
    if (applied === null) return { state: EMigrationState.Unknown, pending: [] }

    const pending = pendingMigrations({ shipped: shippedMigrationNames(), applied })
    if (pending.length > 0) return { state: EMigrationState.Behind, pending }

    this.level = true
    return { state: EMigrationState.Level, pending: [] }
  }

  private async appliedNames(): Promise<readonly string[] | null> {
    try {
      const rows = await db.$queryRaw<AppliedRow[]>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      `
      return rows.map((row) => row.migration_name)
    } catch (cause) {
      return missingTable(cause) ? [] : null
    }
  }
}

const UNDEFINED_TABLE = '42P01'

function missingTable(cause: unknown): boolean {
  if (typeof cause !== 'object' || cause === null) return false
  const code = Reflect.get(cause, 'code')
  return code === UNDEFINED_TABLE
}
