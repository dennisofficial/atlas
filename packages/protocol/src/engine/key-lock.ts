export class KeyLock {
  private readonly tails = new Map<string, Promise<void>>()

  run<T>(args: { key: string; task: () => Promise<T> }): Promise<T> {
    const previous = this.tails.get(args.key) ?? Promise.resolve()
    const result = previous.then(args.task)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.tails.set(args.key, tail)
    void tail.then(() => {
      if (this.tails.get(args.key) === tail) this.tails.delete(args.key)
    })
    return result
  }
}
