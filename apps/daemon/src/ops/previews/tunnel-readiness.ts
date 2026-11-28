import type { ManagedExit, ManagedProcess } from '../../process/managed'

export const REGISTERED_MARKER = 'Registered tunnel connection'
const READY_POLL_MS = 100
const OUTPUT_TAIL_CHARS = 2_000

export type Readiness =
  | { kind: 'registered' }
  | { kind: 'exited'; exit: ManagedExit }
  | { kind: 'timeout' }

export const tailOf = (output: string): string =>
  output === '' ? '(cloudflared printed nothing)' : output.slice(-OUTPUT_TAIL_CHARS)

export const exitLabelOf = (exit: ManagedExit): string =>
  exit.exitCode !== null ? `code ${exit.exitCode}` : `signal ${exit.signal ?? 'unknown'}`

export const waitForRegistration = (args: {
  child: ManagedProcess
  output: () => string
  timeoutMs: number
}): Promise<Readiness> =>
  new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (readiness: Readiness): void => {
      if (timer !== undefined) clearTimeout(timer)
      resolve(readiness)
    }
    const deadline = performance.now() + args.timeoutMs
    const check = (): void => {
      if (args.output().includes(REGISTERED_MARKER)) return finish({ kind: 'registered' })
      if (performance.now() >= deadline) return finish({ kind: 'timeout' })
      timer = setTimeout(check, READY_POLL_MS)
    }
    void args.child.exit().then((exit) => finish({ kind: 'exited', exit }))
    check()
  })
