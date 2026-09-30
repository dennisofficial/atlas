export async function waitForInput(args: { done: Promise<void>; signal?: AbortSignal | undefined }): Promise<void> {
  const { signal } = args
  if (signal === undefined) return args.done
  signal.throwIfAborted()
  let handleAbort = (): void => undefined
  const aborted = new Promise<never>((_, reject) => {
    handleAbort = () => reject(signal.reason ?? new Error('input preparation interrupted'))
    signal.addEventListener('abort', handleAbort, { once: true })
  })
  try {
    await Promise.race([args.done, aborted])
  } finally {
    signal.removeEventListener('abort', handleAbort)
  }
}
