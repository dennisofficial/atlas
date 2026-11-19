export const LOGIN_SHELL_TIMEOUT_MS = 3_000

export const createLoginShellPath = (args: {
  spawn: typeof Bun.spawn
  shell?: string | undefined
  env?: Record<string, string | undefined>
  timeoutMs?: number
}): { path(): Promise<string> } => {
  const timeoutMs = args.timeoutMs ?? LOGIN_SHELL_TIMEOUT_MS
  const fallback = args.env?.PATH ?? ''
  let memoized: Promise<string> | undefined

  const answer = async (): Promise<string> => {
    const shell = args.shell ?? args.env?.SHELL ?? '/bin/zsh'
    let child: ReturnType<typeof args.spawn>
    try {
      child = args.spawn({
        cmd: [shell, '-ilc', 'printf %s "$PATH"'],
        env: { ...args.env },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
      })
    } catch {
      return fallback
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<string>((resolve) => {
      timer = setTimeout(() => {
        child.kill('SIGKILL')
        resolve('')
      }, timeoutMs)
    })
    const collect = async (): Promise<string> => {
      try {
        const text = await new Response(child.stdout as ReadableStream<Uint8Array>).text()
        const code = await child.exited
        return code === 0 ? text : ''
      } catch {
        return ''
      }
    }
    try {
      const answered = (await Promise.race([collect(), timeout])).trim()
      return answered === '' ? fallback : answered
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    path: () => {
      memoized ??= answer()
      return memoized
    },
  }
}
