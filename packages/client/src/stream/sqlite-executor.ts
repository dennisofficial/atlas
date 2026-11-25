export type SqlValue = string | number | null

export type SqliteExecutor = {
  execAsync(sql: string): Promise<void>
  runAsync(sql: string, ...params: readonly SqlValue[]): Promise<void>
  getAllAsync(sql: string, ...params: readonly SqlValue[]): Promise<readonly unknown[]>
  withTransactionAsync(run: () => Promise<void>): Promise<void>
}
