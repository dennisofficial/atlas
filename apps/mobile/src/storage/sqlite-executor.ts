import type { SqliteExecutor } from '@dltech/atlas-client/stream'
import { openDatabaseAsync } from 'expo-sqlite'

export const openSqliteExecutor = async (database: string): Promise<SqliteExecutor> => {
  const db = await openDatabaseAsync(database)
  return {
    execAsync: (sql) => db.execAsync(sql).then(() => undefined),
    runAsync: async (sql, ...params) => {
      await db.runAsync(sql, [...params])
    },
    getAllAsync: (sql, ...params) => db.getAllAsync<unknown>(sql, [...params]),
    withTransactionAsync: (run) => db.withTransactionAsync(run),
  }
}
