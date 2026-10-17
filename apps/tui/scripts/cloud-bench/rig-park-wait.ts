import { EConnectionView } from '@dltech/atlas-harness'
import { ERuntimePhase } from '@dltech/atlas-wire'

import { EVerdict, type Observation, ScenarioFailed, type ScenarioEvidence, type ScenarioFailure } from './rig-evidence'
import type { ChannelWatch } from './rig-observer'
import type { BoxProbe, Probes } from './rig-probes'

export const PARK_POLL_MS = 15_000
export const PARK_WITHIN_MS = 8 * 60_000
export const PARKED_PROVIDERS: ReadonlySet<string> = new Set(['stopped', 'snapshotting', 'stopping'])

const PARK_LOG_LINES = 60
const DRIVER_TAIL_LINES = 40
const UNPROBED = 'unprobed'

const SIDEBAR_MARKS: ReadonlyMap<string, string> = new Map([
  [EConnectionView.Connected, '⏺ connected'],
  [EConnectionView.Waking, '⏺ waking'],
  [EConnectionView.Reconnecting, '⏺ reconnecting'],
  [EConnectionView.Updating, '⏺ updating'],
  [EConnectionView.Parked, '○ parked'],
  [EConnectionView.Disconnected, '✗ disconnected'],
  [EConnectionView.Detached, '✗ detached'],
])

export type ParkWaitContext = {
  probes: Pick<Probes, 'box'>
  rig: () => { channel: () => { connection: () => { state: string } } | null }
  sandboxName: () => string
  log: (line: string) => void
}

export type ParkWait = {
  observations: Observation[]
  provider: string
  lastLogTail: string | null
  parkedAtMs: number | null
}

export type Criterion = { name: string; expected: string; observed: string; held: boolean }

export class EvidencedScenarioFailed extends ScenarioFailed {
  readonly evidence: ScenarioEvidence

  constructor(args: { failure: ScenarioFailure; evidence: ScenarioEvidence }) {
    super(args.failure)
    this.evidence = args.evidence
  }
}

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const stampsOf = (probe: BoxProbe): string | null =>
  probe.version === null ? null : `${probe.version} / protocol ${probe.protocol ?? '?'}`

const probeNoteOf = (probe: BoxProbe): string | undefined => {
  const parts = [
    probe.record === null ? null : `box record ${probe.record.phase} r${probe.record.revision}`,
    probe.recordError,
    probe.servePid === null ? null : `serve pid ${probe.servePid}`,
  ].filter((part): part is string => part !== null)
  return parts.length === 0 ? undefined : parts.join('; ')
}

const pollOnce = async (args: {
  ctx: ParkWaitContext
  watch: ChannelWatch
  poll: number
}): Promise<{ observation: Observation; probe: BoxProbe | null }> => {
  const at = new Date().toISOString()
  const step = `wait for park (poll ${args.poll})`
  const view = args.ctx.rig().channel()?.connection().state ?? null
  const phase = args.watch.lastPhase()
  try {
    const probe = await args.ctx.probes.box({ name: args.ctx.sandboxName(), logLines: PARK_LOG_LINES })
    const observation = { at, step, view, phase, stamps: stampsOf(probe), provider: probe.provider, note: probeNoteOf(probe) }
    return { observation, probe }
  } catch (error) {
    const observation = { at, step, view, phase, stamps: null, provider: null, note: `probe failed: ${messageOf(error)}` }
    return { observation, probe: null }
  }
}

export async function waitForPark(args: {
  ctx: ParkWaitContext
  watch: ChannelWatch
  within: number
  every?: number | undefined
}): Promise<ParkWait> {
  const every = args.every ?? PARK_POLL_MS
  const deadline = Date.now() + args.within
  const observations: Observation[] = []
  let provider = UNPROBED
  let lastLogTail: string | null = null
  for (let poll = 1; ; poll += 1) {
    const { observation, probe } = await pollOnce({ ctx: args.ctx, watch: args.watch, poll })
    observations.push(observation)
    args.ctx.log(
      `park poll ${poll}: view ${observation.view ?? 'none'}, record ${observation.phase ?? 'none'}, provider ${observation.provider ?? 'unknown'}`,
    )
    if (probe !== null) {
      provider = probe.provider
      lastLogTail = probe.logTail ?? lastLogTail
    }
    if (probe !== null && !probe.running && observation.phase === ERuntimePhase.Parked) {
      return { observations, provider, lastLogTail, parkedAtMs: Date.now() }
    }
    const remaining = deadline - Date.now()
    if (remaining <= 0) return { observations, provider, lastLogTail, parkedAtMs: null }
    await Bun.sleep(Math.min(every, remaining))
  }
}

export function frameLineFor(args: { frame: string; view: string | null }): string | null {
  const mark = args.view === null ? undefined : SIDEBAR_MARKS.get(args.view)
  if (mark === undefined) return null
  const line = args.frame.split('\n').find((candidate) => candidate.includes(mark))
  return line === undefined ? null : line.trim()
}

export function frameNoteOf(args: { frame: string; view: string | null }): string {
  const line = frameLineFor(args)
  if (line !== null) return `frame: ${line}`
  return `frame: no sidebar line "${SIDEBAR_MARKS.get(args.view ?? '') ?? '?'}" for view ${args.view ?? 'none'}`
}

export function standardLogs(args: {
  watch: ChannelWatch
  logTail: string | null
  driverLines: readonly string[]
}): { label: string; text: string }[] {
  const phases = args.watch
    .checkpoints()
    .map((checkpoint) => `${checkpoint.reportedAt} ${checkpoint.phase} (revision ${checkpoint.revision})`)
  return [
    { label: 'view timeline', text: args.watch.views().join(' → ') },
    { label: 'checkpoint phases', text: phases.length === 0 ? '(no checkpoint observed)' : phases.join('\n') },
    { label: 'serve log tail', text: args.logTail ?? '(never read: the box was not running at any probe)' },
    {
      label: `driver lines (last ${DRIVER_TAIL_LINES})`,
      text: args.driverLines.length === 0 ? '(none)' : args.driverLines.slice(-DRIVER_TAIL_LINES).join('\n'),
    },
  ]
}

export const criteriaText = (criteria: readonly Criterion[]): string =>
  criteria
    .map((criterion) => `${criterion.held ? '✓' : '✗'} ${criterion.name} — expected ${criterion.expected}; observed ${criterion.observed}`)
    .join('\n')

export function concluded(args: {
  step: string
  evidence: Omit<ScenarioEvidence, 'verdict' | 'failure' | 'reason'>
  criteria: readonly Criterion[]
}): ScenarioEvidence {
  const logs = [{ label: 'criteria', text: criteriaText(args.criteria) }, ...args.evidence.logs]
  const misses = args.criteria.filter((criterion) => !criterion.held)
  if (misses.length === 0) return { ...args.evidence, logs, verdict: EVerdict.Pass }
  const failure: ScenarioFailure = {
    step: `${args.step}: ${misses.map((miss) => miss.name).join(', ')}`,
    expected: misses.map((miss) => `${miss.name}: ${miss.expected}`).join('; '),
    observed: misses.map((miss) => `${miss.name}: ${miss.observed}`).join('; '),
  }
  throw new EvidencedScenarioFailed({ failure, evidence: { ...args.evidence, logs, verdict: EVerdict.Fail, failure } })
}
