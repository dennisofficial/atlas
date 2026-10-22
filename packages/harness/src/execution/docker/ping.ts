const DEFAULT_PING_TIMEOUT_MS = 2000

export async function pingDocker(args: {
  socketPath: string
  timeoutMs?: number | undefined
}): Promise<string | undefined> {
  try {
    const response = await fetch('http://localhost/_ping', {
      unix: args.socketPath,
      signal: AbortSignal.timeout(args.timeoutMs ?? DEFAULT_PING_TIMEOUT_MS),
    })
    if (!response.ok) return `Docker answered _ping with HTTP ${response.status}`
    const body = (await response.text()).trim()
    return body === 'OK'
      ? undefined
      : `Docker answered _ping with an unexpected body: ${body.slice(0, 80)}`
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
