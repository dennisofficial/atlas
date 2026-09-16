export interface MigrateDeployRetryOptions {
  run: () => Promise<number>
  sleep: (ms: number) => Promise<void>
  log: (message: string) => void
  attempts?: number
  backoffMs?: number
}

export declare function migrateDeployWithRetry(options: MigrateDeployRetryOptions): Promise<number>
