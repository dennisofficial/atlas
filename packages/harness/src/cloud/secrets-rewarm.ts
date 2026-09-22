export const SECRETS_REWARM_INTERVAL_MS = 60_000

export function scheduleSecretsRewarm(args: {
  warm: () => Promise<void>
  intervalMs?: number
}): () => void {
  const timer = setInterval(() => {
    void args.warm().catch(() => undefined)
  }, args.intervalMs ?? SECRETS_REWARM_INTERVAL_MS)
  timer.unref()

  return () => clearInterval(timer)
}
