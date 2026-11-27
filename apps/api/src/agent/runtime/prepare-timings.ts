export enum EPrepareWork {
  Access = 'access',
  Check = 'check',
  Files = 'files',
  Toolchain = 'toolchain',
}

export class PrepareTimings {
  private readonly ms: Partial<Record<EPrepareWork, number>> = {}

  constructor(private readonly now: () => number = () => performance.now()) {}

  async time<T>(name: EPrepareWork, work: () => Promise<T>): Promise<T> {
    const startedAt = this.now()
    try {
      return await work()
    } finally {
      this.ms[name] = Math.max(0, Math.round(this.now() - startedAt))
    }
  }

  values(): Readonly<Record<string, number>> {
    return { ...this.ms }
  }
}
