export interface PredeployOptions {
  migrate: () => Promise<number>
  verify: () => Promise<number>
  log: (message: string) => void
}

export declare function runPredeploy(options: PredeployOptions): Promise<number>
