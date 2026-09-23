const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

// App Platform drains the load balancer before SIGTERM but its edge keeps reusing pooled
// keep-alive connections to the old container afterwards; closing the listener right away
// refuses those requests and the edge surfaces them as 503s. Serving until just before the
// SIGKILL deadline (grace_period_seconds, 120s by default) answers every straggler instead.
// https://docs.digitalocean.com/products/app-platform/how-to/configure-termination/
export const SHUTDOWN_DRAIN_DELAY_MS = 100_000
export const SHUTDOWN_FORCE_EXIT_MS = 115_000

export function registerGracefulShutdown(args: {
  beginDrain: () => void
  closeApp: () => Promise<unknown>
  drainDelayMs?: number
  forceExitMs?: number
  sleepFn?: (ms: number) => Promise<void>
  exitProcess?: (code: number) => void
  writeLog?: (line: string) => void
  listen?: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void
}): void {
  const sleepFn = args.sleepFn ?? sleep
  const exitProcess = args.exitProcess ?? ((code: number) => process.exit(code))
  const writeLog = args.writeLog ?? ((line: string) => process.stderr.write(`${line}\n`))
  const listen =
    args.listen ??
    ((signal: 'SIGTERM' | 'SIGINT', handler: () => void) => process.on(signal, handler))
  const drainDelayMs = args.drainDelayMs ?? SHUTDOWN_DRAIN_DELAY_MS
  const forceExitMs = args.forceExitMs ?? SHUTDOWN_FORCE_EXIT_MS

  let signalled = false
  let closing = false

  const closeAndExit = async (): Promise<void> => {
    if (closing) return
    closing = true
    await args.closeApp()
    exitProcess(0)
  }

  const handleSignal = (handlerArgs: { signal: string; drain: boolean }): void => {
    if (signalled) return
    signalled = true
    setTimeout(() => exitProcess(0), forceExitMs).unref()
    if (!handlerArgs.drain) {
      writeLog(`received ${handlerArgs.signal}, closing`)
      void closeAndExit()
      return
    }
    writeLog(`received ${handlerArgs.signal}, draining for ${drainDelayMs}ms before closing`)
    args.beginDrain()
    void sleepFn(drainDelayMs).then(closeAndExit)
  }

  listen('SIGTERM', () => handleSignal({ signal: 'SIGTERM', drain: true }))
  listen('SIGINT', () => handleSignal({ signal: 'SIGINT', drain: false }))
}
