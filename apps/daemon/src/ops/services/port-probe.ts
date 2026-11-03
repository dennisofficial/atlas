export const PORT_PROBE_INTERVAL_MS = 100

const probeOnce = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = Bun.connect({
      hostname: '127.0.0.1',
      port,
      socket: {
        open: (connected) => {
          connected.end()
          resolve(true)
        },
        error: () => resolve(false),
        connectError: () => resolve(false),
        data: () => {},
      },
    })
    void socket.catch(() => resolve(false))
  })

export const waitForPort = async (args: {
  port: number
  timeoutMs: number
  cancelled: () => boolean
}): Promise<boolean> => {
  const deadline = Date.now() + args.timeoutMs
  for (;;) {
    if (args.cancelled()) return false
    if (await probeOnce(args.port)) return true
    if (args.cancelled()) return false
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, PORT_PROBE_INTERVAL_MS))
  }
}
