import type { Observation } from './rig-evidence'
import type { Probes } from './rig-probes'

export const SERVE_SWAP_LINE = /drain|rotat|swap|updating|resum|serve\.(started|stopped|listening)/i
export const DRIVER_SWAP_LINE = /drain|rotat|swap|updating|resume|replac/i
export const DRAIN_SEALED_LINE = /serve\.drain-sealed/

const DEFAULT_EVERY_MS = 2_000
const LOG_LINES = 200
const PROBE_FAILED = 'probe failed'

export type SwapSample = {
  at: string
  provider: string
  phase: string | null
  receipt: boolean
  pid: string | null
  version: string | null
  protocol: number | null
  error: string | null
}

export type SwapWatchResult = {
  samples: SwapSample[]
  phases: string[]
  pids: string[]
  versions: string[]
  swapLines: string[]
  lastLogTail: string | null
}

export type SwapWatch = {
  latest: () => SwapSample | null
  swapped: () => boolean
  stop: () => Promise<SwapWatchResult>
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const matchingLines = (args: { text: string; pattern: RegExp }): string[] =>
  args.text.split('\n').filter((line) => args.pattern.test(line))

const uniqueOf = (values: readonly (string | null)[]): string[] => [
  ...new Set(values.filter((value): value is string => value !== null)),
]

const timelineOf = (values: readonly (string | null)[]): string[] =>
  values.reduce<string[]>((timeline, value) => {
    if (value === null || timeline.at(-1) === value) return timeline
    return [...timeline, value]
  }, [])

const sameSample = (args: { left: SwapSample | undefined; right: SwapSample }): boolean =>
  args.left !== undefined &&
  args.left.provider === args.right.provider &&
  args.left.phase === args.right.phase &&
  args.left.pid === args.right.pid &&
  args.left.version === args.right.version &&
  args.left.error === args.right.error

export const describeSample = (sample: SwapSample): string =>
  [
    `provider ${sample.provider}`,
    `record ${sample.phase ?? '—'}${sample.receipt ? ' (receipt)' : ''}`,
    `pid ${sample.pid ?? '—'}`,
    `stamp ${sample.version ?? '—'}/${sample.protocol ?? '—'}`,
    ...(sample.error === null ? [] : [`error ${sample.error}`]),
  ].join(', ')

export function observationsOf(args: {
  samples: readonly SwapSample[]
  step: string
}): Observation[] {
  return args.samples
    .filter((sample, index) => !sameSample({ left: args.samples[index - 1], right: sample }))
    .map((sample) => ({
      at: sample.at,
      step: args.step,
      view: null,
      phase: sample.receipt && sample.phase !== null ? `${sample.phase} (receipt)` : sample.phase,
      stamps: sample.version === null ? null : `${sample.version} / ${sample.protocol ?? '?'}`,
      provider: sample.provider,
      note: sample.pid === null ? (sample.error ?? undefined) : `serve pid ${sample.pid}`,
    }))
}

export function startSwapWatch(args: {
  probes: Probes
  name: string
  from: { pid: string | null; version: string | null }
  log: (line: string) => void
  every?: number | undefined
}): SwapWatch {
  const samples: SwapSample[] = []
  const swapLines: string[] = []
  const seenLines = new Set<string>()
  let lastLogTail: string | null = null
  let stopped = false

  const keepSwapLines = (tail: string): void => {
    for (const line of matchingLines({ text: tail, pattern: SERVE_SWAP_LINE })) {
      if (seenLines.has(line)) continue
      seenLines.add(line)
      swapLines.push(line)
    }
  }

  const sampleNow = async (): Promise<SwapSample> => {
    const at = new Date().toISOString()
    try {
      const probe = await args.probes.box({ name: args.name, logLines: LOG_LINES })
      if (probe.logTail !== null) {
        lastLogTail = probe.logTail
        keepSwapLines(probe.logTail)
      }
      const record = probe.record
      return {
        at,
        provider: probe.provider,
        phase: record?.phase ?? null,
        receipt: record !== null && 'receipt' in record && record.receipt !== undefined,
        pid: probe.servePid,
        version: probe.version,
        protocol: probe.protocol,
        error: probe.recordError,
      }
    } catch (failure) {
      return {
        at,
        provider: PROBE_FAILED,
        phase: null,
        receipt: false,
        pid: null,
        version: null,
        protocol: null,
        error: messageOf(failure),
      }
    }
  }

  const loop = (async () => {
    while (!stopped) {
      const sample = await sampleNow()
      if (!sameSample({ left: samples.at(-1), right: sample }))
        args.log(`box ${describeSample(sample)}`)
      samples.push(sample)
      if (stopped) return
      await Bun.sleep(args.every ?? DEFAULT_EVERY_MS)
    }
  })()

  const result = (): SwapWatchResult => ({
    samples: [...samples],
    phases: timelineOf(samples.map((sample) => sample.phase)),
    pids: uniqueOf(samples.map((sample) => sample.pid)),
    versions: uniqueOf(samples.map((sample) => sample.version)),
    swapLines: [...swapLines],
    lastLogTail,
  })

  return {
    latest: () => samples.at(-1) ?? null,
    swapped: () => {
      const last = samples.at(-1)
      if (last === undefined || last.pid === null || last.version === null) return false
      return (
        last.pid !== args.from.pid && last.version !== args.from.version && last.phase === 'serving'
      )
    },
    stop: async () => {
      stopped = true
      await loop
      return result()
    },
  }
}
