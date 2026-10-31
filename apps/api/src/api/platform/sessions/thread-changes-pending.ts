const realSetTimeout = globalThis.setTimeout
const SETTLE_LIMIT_MS = 3000

const pending = new Set<Promise<void>>()

export function trackThreadChange(work: Promise<void>): void {
  pending.add(work)
  void work.finally(() => pending.delete(work))
}

export async function settleAllThreadChanges(): Promise<void> {
  const expired = new Promise<void>((resolve) => realSetTimeout(resolve, SETTLE_LIMIT_MS))
  const drained = (async () => {
    while (pending.size > 0) await Promise.allSettled([...pending])
  })()
  await Promise.race([drained, expired])
}
