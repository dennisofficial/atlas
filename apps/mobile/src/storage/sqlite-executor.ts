import { openDatabaseAsync } from 'expo-sqlite'

export type SqlValue = string | number | null

export type SqliteExecutor = {
  execAsync(sql: string): Promise<void>
  runAsync(sql: string, ...params: readonly SqlValue[]): Promise<void>
  getAllAsync(sql: string, ...params: readonly SqlValue[]): Promise<readonly unknown[]>
  withTransactionAsync(run: () => Promise<void>): Promise<void>
}

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
