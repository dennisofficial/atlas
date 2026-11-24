import type { EDaemonAnswer } from '@dltech/atlas-core'

import type { DaemonAnswer } from './errors'
import type { DaemonLink } from './link'

export class Answers {
  private readonly asking = new Map<string, (answer: DaemonAnswer) => void>()
  private readonly link: DaemonLink
  private readonly epoch: () => number

  constructor(args: { link: DaemonLink; epoch(): number }) {
    this.link = args.link
    this.epoch = args.epoch
  }

  ask(key: string): Promise<DaemonAnswer> {
    if (!this.link.ready) return Promise.resolve('unavailable')
    return new Promise<DaemonAnswer>((resolve) => {
      this.asking.set(key, resolve)
      this.link.send({ kind: 'answer', key, epoch: this.epoch() })
    })
  }

  settle(args: { key: string; state: DaemonAnswer | EDaemonAnswer }): void {
    const resolve = this.asking.get(args.key)
    if (resolve === undefined) return
    this.asking.delete(args.key)
    resolve(args.state as DaemonAnswer)
  }

  refuseAll(): void {
    for (const key of [...this.asking.keys()]) this.settle({ key, state: 'unavailable' })
  }
}
