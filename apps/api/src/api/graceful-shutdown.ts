export const SHUTDOWN_FORCE_EXIT_MS = 10_000

export function registerGracefulShutdown(args: {
  beginDrain: () => void
  closeApp: () => Promise<unknown>
  forceExitMs?: number
  exitProcess?: (code: number) => void
  writeLog?: (line: string) => void
  listen?: (signal: 'SIGTERM' | 'SIGINT', handler: () => void) => void
}): void {
  const exitProcess = args.exitProcess ?? ((code: number) => process.exit(code))
  const writeLog = args.writeLog ?? ((line: string) => process.stderr.write(`${line}\n`))
  const listen =
    args.listen ??
    ((signal: 'SIGTERM' | 'SIGINT', handler: () => void) => process.on(signal, handler))
  const forceExitMs = args.forceExitMs ?? SHUTDOWN_FORCE_EXIT_MS

  let signalled = false

  const handleSignal = (handlerArgs: { signal: string; drain: boolean }): void => {
    if (signalled) return
    signalled = true
    setTimeout(() => exitProcess(0), forceExitMs).unref()
    writeLog(`received ${handlerArgs.signal}, closing`)
    if (handlerArgs.drain) args.beginDrain()
    void args.closeApp().then(() => exitProcess(0))
  }

  listen('SIGTERM', () => handleSignal({ signal: 'SIGTERM', drain: true }))
  listen('SIGINT', () => handleSignal({ signal: 'SIGINT', drain: false }))
}
