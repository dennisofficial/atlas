export const PORT_PROBE_INTERVAL_MS = 100

export const PORT_PROBE_ATTEMPT_MS = 1_000

const attemptMsOf = (deadline: number): number =>
  Math.max(1, Math.min(PORT_PROBE_ATTEMPT_MS, deadline - Date.now()))

const failsAfter = async (args: { attempt: Promise<boolean>; ms: number }): Promise<boolean> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), args.ms)
  })
  try {
    return await Promise.race([args.attempt, expired])
  } finally {
    clearTimeout(timer)
  }
}

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

const healthyOnce = async (args: {
  port: number
  path: string
  timeoutMs: number
}): Promise<boolean> => {
  try {
    const answer = await fetch(`http://127.0.0.1:${args.port}${args.path}`, {
      signal: AbortSignal.timeout(args.timeoutMs),
    })
    await answer.arrayBuffer()
    return answer.ok
  } catch {
    return false
  }
}

export const waitForHealth = async (args: {
  port: number
  path: string
  timeoutMs: number
  cancelled: () => boolean
}): Promise<boolean> => {
  const deadline = Date.now() + args.timeoutMs
  for (;;) {
    if (args.cancelled()) return false
    const timeoutMs = attemptMsOf(deadline)
    if (await healthyOnce({ port: args.port, path: args.path, timeoutMs })) return true
    if (args.cancelled()) return false
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, PORT_PROBE_INTERVAL_MS))
  }
}

export const waitForPort = async (args: {
  port: number
  timeoutMs: number
  cancelled: () => boolean
}): Promise<boolean> => {
  const deadline = Date.now() + args.timeoutMs
  for (;;) {
    if (args.cancelled()) return false
    if (await failsAfter({ attempt: probeOnce(args.port), ms: attemptMsOf(deadline) })) return true
    if (args.cancelled()) return false
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, PORT_PROBE_INTERVAL_MS))
  }
}
