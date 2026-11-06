export abstract class RefreshLock {
  abstract run<T>(args: { key: string; work: () => Promise<T> }): Promise<T>
}

const settle = (): void => undefined

export class InProcessRefreshLock implements RefreshLock {
  private readonly tails = new Map<string, Promise<void>>()

  async run<T>(args: { key: string; work: () => Promise<T> }): Promise<T> {
    const previous = this.tails.get(args.key) ?? Promise.resolve()
    const turn = previous.then(args.work)
    const tail = turn.then(settle, settle)
    this.tails.set(args.key, tail)
    try {
      return await turn
    } finally {
      if (this.tails.get(args.key) === tail) this.tails.delete(args.key)
    }
  }
}
