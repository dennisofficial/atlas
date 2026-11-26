import type { DaemonLink } from './link'

export class CancelObligations {
  private readonly owed = new Map<string, string>()

  constructor(
    private readonly args: {
      link: DaemonLink
      epoch(): number
      bootId(): string | undefined
    },
  ) {}

  cancel(key: string): void {
    if (this.args.link.ready) {
      this.send(key)
      return
    }
    const bootId = this.args.bootId()
    if (bootId !== undefined) this.owed.set(key, bootId)
  }

  flush(bootId: string): void {
    for (const [key, owedBootId] of [...this.owed]) {
      this.owed.delete(key)
      if (owedBootId === bootId) this.send(key)
    }
  }

  clear(): void {
    this.owed.clear()
  }

  private send(key: string): void {
    this.args.link.send({ kind: 'cancel', key, epoch: this.args.epoch() })
  }
}
