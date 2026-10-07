import type { BakedRuntime } from './runtime'

export type SummarySample = {
  liftMs: number
  descendMs: number
  runtime: BakedRuntime
  workspaceCommit: string
  [key: string]: unknown
}

const distribution = (values: readonly number[]) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const atMiddle = sorted[middle]
  if (atMiddle === undefined) throw new Error('cannot summarize an empty benchmark')
  const medianMs =
    sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? atMiddle) + atMiddle) / 2 : atMiddle
  return { minMs: sorted[0], medianMs, maxMs: sorted.at(-1), samples: sorted.length }
}

export const summarizeSamples = (samples: readonly SummarySample[]) => {
  const first = samples[0]
  if (first === undefined) throw new Error('cannot summarize an empty benchmark')
  const runtimeKey = (runtime: BakedRuntime) =>
    JSON.stringify([runtime.version, runtime.protocol, runtime.bakeId])
  const runtimeDrift = samples.some(
    (sample) => runtimeKey(sample.runtime) !== runtimeKey(first.runtime),
  )
  const workspaceDrift = samples.some((sample) => sample.workspaceCommit !== first.workspaceCommit)
  return {
    samples,
    lift: distribution(samples.map((sample) => sample.liftMs)),
    descend: distribution(samples.map((sample) => sample.descendMs)),
    comparable: !runtimeDrift && !workspaceDrift,
    runtimeDrift,
    workspaceDrift,
  }
}
