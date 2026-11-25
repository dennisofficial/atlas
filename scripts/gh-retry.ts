export const MAX_ATTEMPTS = 3
export const DELAY_STEP_MS = 2000

export enum ECall {
  Create = 'create',
  Upload = 'upload',
}

export enum EFailureKind {
  Http = 'http',
  Network = 'network',
  Unknown = 'unknown',
}

export type Failure =
  | { kind: EFailureKind.Http; status: number; alreadyExists: boolean }
  | { kind: EFailureKind.Network | EFailureKind.Unknown }

export enum ENext {
  Succeed = 'succeed',
  Retry = 'retry',
  Fail = 'fail',
}

export interface GhAttempt {
  code: number
  output: string
}

const NETWORK_MARKERS = [
  'connection reset',
  'connection refused',
  'connection timed out',
  'dial tcp',
  'i/o timeout',
  'TLS handshake timeout',
  'http2',
  'no such host',
  'temporary failure in name resolution',
  'stream error',
  'REFUSED_STREAM',
  'unexpected EOF',
  'read: EOF',
]

export const statusOf = (output: string): number | null => {
  const match = /HTTP (\d{3})\b/.exec(output)
  const digits = match?.[1]
  return digits === undefined ? null : Number(digits)
}

export const failureOf = (attempt: GhAttempt): Failure | null => {
  if (attempt.code === 0) return null
  const status = statusOf(attempt.output)
  if (status !== null) {
    const alreadyExists =
      status === 422 &&
      (attempt.output.includes('already_exists') || attempt.output.includes('already exists'))
    return { kind: EFailureKind.Http, status, alreadyExists }
  }
  if (NETWORK_MARKERS.some((marker) => attempt.output.includes(marker)))
    return { kind: EFailureKind.Network }
  return { kind: EFailureKind.Unknown }
}

const isAlreadyExists = (failure: Failure): boolean =>
  failure.kind === EFailureKind.Http && failure.alreadyExists

const isRetryable = (args: { call: ECall; failure: Failure }): boolean => {
  const { call, failure } = args
  if (failure.kind === EFailureKind.Network) return true
  if (failure.kind !== EFailureKind.Http) return false
  if (failure.status >= 500) return true
  if (failure.status === 404 && call === ECall.Upload) return true
  return false
}

const withinAttempts = (attempt: number): ENext =>
  attempt < MAX_ATTEMPTS ? ENext.Retry : ENext.Fail

const createdByAnEarlierAttempt = (attempt: number): ENext =>
  attempt > 1 ? ENext.Succeed : ENext.Fail

// A 5xx upload leaves its asset behind, so the next attempt answers 422 already_exists and must
// delete it and upload again (goreleaser/goreleaser#2746). An upload also answers 404 just after its
// release exists, including a --clobber delete that raced the overwrite (cli/cli#10361).
export const decideNext = (args: { call: ECall; attempt: number; failure: Failure }): ENext => {
  const { call, attempt, failure } = args
  if (isAlreadyExists(failure))
    return call === ECall.Create ? createdByAnEarlierAttempt(attempt) : withinAttempts(attempt)
  if (isRetryable({ call, failure })) return withinAttempts(attempt)
  return ENext.Fail
}

export const delayMsOf = (attempt: number): number => attempt * DELAY_STEP_MS

export const describeFailure = (failure: Failure): string => {
  if (failure.kind === EFailureKind.Http) return `HTTP ${failure.status}`
  if (failure.kind === EFailureKind.Network) return 'network error'
  return 'unknown error'
}

const spawnGh = (argv: readonly string[]): GhAttempt => {
  const result = Bun.spawnSync({ cmd: [...argv], stdout: 'pipe', stderr: 'pipe' })
  const stdout = result.stdout.toString()
  const stderr = result.stderr.toString()
  process.stdout.write(stdout)
  process.stdout.write(stderr)
  return { code: result.exitCode, output: `${stdout}${stderr}` }
}

export async function runGh(args: {
  call: ECall
  argv: readonly string[]
  spawn?: (argv: readonly string[]) => GhAttempt
  sleep?: (ms: number) => Promise<void>
}): Promise<void> {
  const spawn = args.spawn ?? spawnGh
  const sleep = args.sleep ?? ((ms: number): Promise<void> => Bun.sleep(ms))
  const shown = args.argv.join(' ')
  for (let attempt = 1; ; attempt++) {
    const result = spawn(args.argv)
    const failure = failureOf(result)
    if (failure === null) return
    const next = decideNext({ call: args.call, attempt, failure })
    if (next === ENext.Succeed) {
      console.log(`${shown} answered ${describeFailure(failure)}; the release exists, continuing`)
      return
    }
    if (next === ENext.Fail)
      throw new Error(`${shown} failed on attempt ${attempt}: ${describeFailure(failure)}`)
    const delay = delayMsOf(attempt)
    console.log(
      `::warning::${shown} failed on attempt ${attempt} (${describeFailure(failure)}); retrying in ${delay} ms`,
    )
    await sleep(delay)
  }
}

export type GhRetryArgs = { call: ECall; command: string[] }

export const parseGhRetryArgs = (argv: readonly string[]): GhRetryArgs => {
  const separator = argv.indexOf('--')
  if (separator === -1) throw new Error('usage: gh-retry --call=<create|upload> -- <gh args>')
  const flags = argv.slice(0, separator)
  const command = argv.slice(separator + 1)
  if (command.length === 0) throw new Error('usage: gh-retry --call=<create|upload> -- <gh args>')
  const unknown = flags.filter((flag) => !flag.startsWith('--call='))
  if (unknown.length > 0) throw new Error(`unknown flags: ${unknown.join(', ')}`)
  const value = flags.find((flag) => flag.startsWith('--call='))?.slice('--call='.length)
  if (value === undefined) throw new Error('usage: gh-retry --call=<create|upload> -- <gh args>')
  const call = [ECall.Create, ECall.Upload].find((candidate) => candidate === value)
  if (call === undefined) throw new Error(`unknown call: ${value}`)
  return { call, command }
}

async function main(): Promise<void> {
  const parsed = parseGhRetryArgs(process.argv.slice(2))
  try {
    await runGh({ call: parsed.call, argv: parsed.command })
  } catch (error) {
    console.log(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
