import type { DaemonLink } from './link'

import type { CancelDebt } from './cancel-debts'

export class CancelObligations {
  private readonly owed = new Map<string, string | undefined>()

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

  owe(debt: CancelDebt): void {
    this.owed.set(debt.key, debt.bootId)
  }

  flush(bootId: string): void {
    for (const [key, owedBootId] of [...this.owed]) {
      if (owedBootId !== undefined && owedBootId !== bootId) continue
      this.owed.delete(key)
      this.send(key)
    }
  }

  clear(): void {
    this.owed.clear()
  }

  private send(key: string): void {
    this.args.link.send({ kind: 'cancel', key, epoch: this.args.epoch() })
  }
}
