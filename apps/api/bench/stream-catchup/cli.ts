import { PROFILE_NAMES } from './profiles'

export const START_NAMES = ['none', 'zero', 'head-1000', 'head-10'] as const

export type StartName = (typeof START_NAMES)[number]

export type BenchOptions = {
  sizes: readonly number[]
  profiles: readonly string[]
  starts: readonly StartName[]
  timeoutMs: number
  queryDelayMs: number
  seed: number
  json: boolean
  quick: boolean
}

const QUICK_SIZES = [500, 5_000]
const QUICK_PROFILES = ['fast', 'wifi-flaky']
const DEFAULT_TIMEOUT_MS = 120_000
const DEFAULT_QUERY_DELAY_MS = 2
const DEFAULT_SEED = 7

const listOf = (value: string): string[] => value.split(',').filter((entry) => entry.length > 0)

const numbersOf = (value: string): number[] =>
  listOf(value).map((entry) => {
    const parsed = Number(entry)
    if (!Number.isFinite(parsed)) throw new Error(`not a number: ${entry}`)
    return parsed
  })

const startOf = (value: string): StartName => {
  const match = START_NAMES.find((name) => name === value)
  if (match === undefined) throw new Error(`unknown start ${value}`)
  return match
}

export const parseArgs = (argv: readonly string[]): BenchOptions => {
  const quick = argv.includes('--quick')
  const valueOf = (flag: string): string | undefined => {
    const prefix = `${flag}=`
    const found = argv.find((entry) => entry.startsWith(prefix))
    return found === undefined ? undefined : found.slice(prefix.length)
  }
  const sizes = valueOf('--sizes')
  const profiles = valueOf('--profiles')
  const starts = valueOf('--starts')
  const timeout = valueOf('--timeout-ms')
  const queryDelay = valueOf('--query-delay-ms')
  const seed = valueOf('--seed')
  return {
    sizes: sizes === undefined ? (quick ? QUICK_SIZES : [500, 5_000, 20_000]) : numbersOf(sizes),
    profiles: profiles === undefined ? (quick ? QUICK_PROFILES : PROFILE_NAMES) : listOf(profiles),
    starts: starts === undefined ? [...START_NAMES] : listOf(starts).map(startOf),
    timeoutMs: timeout === undefined ? DEFAULT_TIMEOUT_MS : Number(timeout),
    queryDelayMs: queryDelay === undefined ? DEFAULT_QUERY_DELAY_MS : Number(queryDelay),
    seed: seed === undefined ? DEFAULT_SEED : Number(seed),
    json: !argv.includes('--no-json'),
    quick,
  }
}

export const startSeqOf = (args: { start: StartName; head: number }): number | undefined => {
  if (args.start === 'none') return undefined
  if (args.start === 'zero') return 0
  if (args.start === 'head-1000') return Math.max(0, args.head - 1_000)
  return Math.max(0, args.head - 10)
}
