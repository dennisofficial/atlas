import { join } from 'node:path'

import {
  CHANNEL_PROTOCOL_VERSION,
  CHANNEL_SUBPROTOCOL,
  EClientFrame,
  EServeFrame,
  bearerSubprotocolOf,
  decodeServeFrame,
  encodeFrame,
} from '@dltech/atlas-wire'
import type { ThreadId } from '@dltech/atlas-core'
import { sandboxNameFor } from '@dltech/atlas-harness'

import { EVerdict, ScenarioFailed, trustOf, type ScenarioEvidence, type ScenarioFailure } from './rig-evidence'
import type { Ledger } from './rig-ledger'
import type { RigApp } from './rig-mount'
import { EvidencedScenarioFailed } from './rig-park-wait'
import type { Probes } from './rig-probes'

export type RigArgs = {
  scenarios: number[]
  out: string
  repo: string
  keep: boolean
  cleanup: boolean
  mismatch: string | undefined
}

export type ParsedRigArgs = { ok: true; args: RigArgs } | { ok: false; error: string }

export type RigTrust = { trusted: boolean; reason: string }

export type EvidenceLog = { label: string; text: string }

export type ScenarioHead = { id: number; slug: string; title: string }

export type ScenarioResult = ScenarioHead & { verdict: EVerdict; path: string | null }

export const FRESH_ID = 1
export const API_WAKE_ID = 6
export const KNOWN_IDS: readonly number[] = [1, 2, 3, 4, 5, 6]
export const DEFAULT_REPO = 'https://github.com/octocat/Hello-World'
const DEFAULT_SCENARIOS: readonly number[] = [1, 2, 3, 4, 5]
const THREAD_DEPENDENT_IDS: ReadonlySet<number> = new Set([2, 3, 4, 5])
const HELLO_TIMEOUT_MS = 30_000
const FAILURE_LOG_LINES = 80
const FAILURE_DRIVER_LINES = 40

export const UNGATED_TRUST: RigTrust = { trusted: false, reason: 'the trust gate never ran (scenario 1 did not finish)' }

export const USAGE = [
  'Live Vercel rig: drives one real cloud thread through birth, park, wake and swap.',
  '',
  'Gated: does nothing unless ATLAS_LIVE_RIG=1.',
  '',
  '  cd apps/tui && ATLAS_LIVE_RIG=1 NODE_ENV=development bun scripts/cloud-bench/live-rig.tsx [options]',
  '',
  '  --scenarios=1,2,3    scenario ids to run (default 1,2,3,4,5; 1 is added when 2-5 are asked; 6 always writes NOT RUN)',
  '  --out=<dir>          evidence directory (default $ATLAS_CONTEXT_DIR/evidence/live-rig)',
  `  --repo=<https url>   workspace to clone (default ${DEFAULT_REPO})`,
  '  --mismatch=<mode>    scenario 5 mismatch: source-edit (default) or forge-stamp',
  '  --keep               leave the sandboxes running at the end',
  '  --cleanup            destroy every sandbox named in <out>/ledger.json, then exit',
].join('\n')

const valueOf = (args: { arg: string; flag: string }): string | null =>
  args.arg.startsWith(`${args.flag}=`) ? args.arg.slice(args.flag.length + 1) : null

export function scenarioIdsOf(requested: readonly number[]): number[] {
  const ids = new Set(requested)
  if ([...ids].some((id) => THREAD_DEPENDENT_IDS.has(id))) ids.add(FRESH_ID)
  ids.add(API_WAKE_ID)
  return [...ids].sort((left, right) => left - right)
}

const parseIds = (text: string): number[] | string => {
  const parts = text.split(',').map((part) => part.trim()).filter((part) => part.length > 0)
  if (parts.length === 0) return '--scenarios needs at least one id'
  const ids = parts.map(Number)
  const unknown = parts.filter((_, index) => !KNOWN_IDS.includes(ids[index] ?? Number.NaN))
  if (unknown.length > 0) return `unknown scenario id(s): ${unknown.join(', ')} (known: ${KNOWN_IDS.join(', ')})`
  return ids
}

export function parseRigArgs(args: { argv: readonly string[]; env: Record<string, string | undefined> }): ParsedRigArgs {
  let requested: readonly number[] = DEFAULT_SCENARIOS
  let out: string | null = null
  let repo = DEFAULT_REPO
  let keep = false
  let cleanup = false
  let mismatch: string | undefined
  for (const arg of args.argv) {
    const scenarios = valueOf({ arg, flag: '--scenarios' })
    const outValue = valueOf({ arg, flag: '--out' })
    const repoValue = valueOf({ arg, flag: '--repo' })
    const mismatchValue = valueOf({ arg, flag: '--mismatch' })
    if (scenarios !== null) {
      const ids = parseIds(scenarios)
      if (typeof ids === 'string') return { ok: false, error: ids }
      requested = ids
    } else if (outValue !== null && outValue.length > 0) out = outValue
    else if (repoValue !== null && repoValue.length > 0) repo = repoValue
    else if (mismatchValue !== null && mismatchValue.length > 0) mismatch = mismatchValue
    else if (arg === '--keep') keep = true
    else if (arg === '--cleanup') cleanup = true
    else return { ok: false, error: `unknown argument: ${arg}` }
  }
  if (!repo.startsWith('https://')) return { ok: false, error: `--repo must be an https git url (the sandbox clones it), got ${repo}` }
  const contextDir = args.env.ATLAS_CONTEXT_DIR
  if (out === null && (contextDir === undefined || contextDir.length === 0)) {
    return { ok: false, error: 'pass --out=<dir>: ATLAS_CONTEXT_DIR is not set' }
  }
  return {
    ok: true,
    args: { scenarios: scenarioIdsOf(requested), out: out ?? join(contextDir ?? '', 'evidence', 'live-rig'), repo, keep, cleanup, mismatch },
  }
}

export function notRunReasonOf(args: { id: number; verdicts: ReadonlyMap<number, EVerdict> }): string | null {
  if (!THREAD_DEPENDENT_IDS.has(args.id)) return null
  const fresh = args.verdicts.get(FRESH_ID)
  if (fresh === EVerdict.Pass) return null
  return `depends on scenario 1, which ${fresh === undefined ? 'did not run' : `ended ${fresh}`}`
}

export const notRunEvidence = (args: { scenario: ScenarioHead; reason: string }): ScenarioEvidence => ({
  ...args.scenario,
  commands: [],
  observations: [],
  logs: [],
  verdict: EVerdict.NotRun,
  reason: args.reason,
})

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function failedEvidence(args: { scenario: ScenarioHead; error: unknown; tails: readonly EvidenceLog[] }): ScenarioEvidence {
  if (args.error instanceof EvidencedScenarioFailed) {
    const base = args.error.evidence
    return { ...base, logs: [...base.logs, ...args.tails], verdict: EVerdict.Fail, failure: args.error.failure }
  }
  const failure: ScenarioFailure =
    args.error instanceof ScenarioFailed
      ? args.error.failure
      : { step: 'unexpected error', expected: 'the scenario to run to a verdict', observed: messageOf(args.error) }
  return { ...args.scenario, commands: [], observations: [], logs: [...args.tails], verdict: EVerdict.Fail, failure }
}

export function combinedTrust(args: { version: string | null; boxProtocol: number | null; readyProtocol: number | null }): RigTrust {
  const box = trustOf({ version: args.version, protocol: args.boxProtocol })
  if (!box.trusted) return { trusted: false, reason: `box stamps: ${box.reason}` }
  if (args.readyProtocol === null) return { trusted: false, reason: 'channel Ready frame: no Ready protocol was read' }
  const ready = trustOf({ version: args.version, protocol: args.readyProtocol })
  if (!ready.trusted) return { trusted: false, reason: `channel Ready frame: ${ready.reason}` }
  return { trusted: true, reason: `${box.reason}; the channel Ready frame carried protocol ${args.readyProtocol}` }
}

export function withTrust(args: { evidence: ScenarioEvidence; trust: RigTrust }): ScenarioEvidence {
  const { evidence, trust } = args
  if (trust.trusted || evidence.verdict === EVerdict.NotRun || evidence.verdict === EVerdict.Untrusted) return evidence
  const reason = [`untrusted: ${trust.reason}`, `underlying verdict: ${evidence.verdict}`, evidence.reason]
    .filter((part): part is string => part !== undefined)
    .join('\n\n')
  return { ...evidence, verdict: EVerdict.Untrusted, reason }
}

export const exitCodeOf = (results: readonly ScenarioResult[]): number =>
  results.every((result) => result.verdict === EVerdict.Pass || result.verdict === EVerdict.NotRun) ? 0 : 1

const listOf = (names: readonly string[]): string => (names.length === 0 ? '(none)' : names.map((name) => `\`${name}\``).join(', '))

export function renderSummary(args: {
  startedAt: string
  finishedAt: string
  threadId: string | null
  trust: RigTrust
  results: readonly ScenarioResult[]
  created: readonly string[]
  destroyed: readonly string[]
  destroyFailures: readonly string[]
  kept: boolean
  interruptedBy: string | null
}): string {
  const rows = args.results.map(
    (result) => `| ${result.id} | ${result.title} | ${result.verdict} | ${result.path === null ? '—' : result.path} |`,
  )
  return [
    '# Live rig run summary',
    '',
    `- started: ${args.startedAt}`,
    `- finished: ${args.finishedAt}`,
    `- thread: ${args.threadId ?? '(never born)'}`,
    `- trust gate: ${args.trust.trusted ? 'trusted' : 'UNTRUSTED'} — ${args.trust.reason}`,
    ...(args.interruptedBy === null ? [] : [`- interrupted by ${args.interruptedBy}`]),
    '',
    '## Verdicts',
    '',
    '| scenario | title | verdict | evidence |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## Sandboxes',
    '',
    `- created: ${listOf(args.created)}`,
    `- destroyed: ${args.kept ? '(kept: --keep)' : listOf(args.destroyed)}`,
    ...(args.destroyFailures.length === 0 ? [] : [`- destroy failures: ${args.destroyFailures.join('; ')}`]),
    '',
  ].join('\n')
}

export async function failureTails(args: { rig: RigApp | null; probes: Pick<Probes, 'box'> }): Promise<EvidenceLog[]> {
  if (args.rig === null) return []
  const label = `serve log tail at failure (${FAILURE_LOG_LINES} lines)`
  const serveTail = await args.probes
    .box({ name: sandboxNameFor({ threadId: args.rig.threadId }), logLines: FAILURE_LOG_LINES })
    .then(
      (probe) => (probe.running ? (probe.logTail ?? '(empty)') : `(not read: provider ${probe.provider})`),
      (error: unknown) => `(probe failed: ${messageOf(error)})`,
    )
  const driverTail = args.rig.driverLines.slice(-FAILURE_DRIVER_LINES).join('\n')
  return [
    { label, text: serveTail },
    { label: `driver lines at failure (last ${FAILURE_DRIVER_LINES})`, text: driverTail || '(none)' },
  ]
}

export async function destroyLedgerNames(args: {
  ledger: Ledger
  probes: Pick<Probes, 'destroy'>
  log: (line: string) => void
}): Promise<{ destroyed: string[]; failures: string[] }> {
  const names = [...new Set((await args.ledger.entries()).map((entry) => entry.name))]
  const destroyed: string[] = []
  const failures: string[] = []
  for (const name of names) {
    try {
      await args.probes.destroy({ name, ledger: args.ledger, log: args.log })
      destroyed.push(name)
    } catch (error) {
      failures.push(`${name}: ${messageOf(error)}`)
      args.log(`destroy ${name} failed: ${messageOf(error)}`)
    }
  }
  return { destroyed, failures }
}

export const helloProtocol = (args: { url: string; token: string; threadId: ThreadId }): Promise<number | null> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(`${args.url.replace(/^http/, 'ws')}/v1/session`, [
      CHANNEL_SUBPROTOCOL,
      bearerSubprotocolOf(args.token),
    ])
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('the raw hello got no Ready within 30 s'))
    }, HELLO_TIMEOUT_MS)
    socket.onmessage = (event) => {
      const frame = decodeServeFrame(String(event.data))
      if (frame === null || frame.kind !== EServeFrame.Ready) return
      clearTimeout(timeout)
      socket.close()
      resolve(frame.protocol ?? null)
    }
    socket.onerror = () => {
      clearTimeout(timeout)
      reject(new Error('the raw hello socket failed before Ready'))
    }
    socket.onopen = () => {
      socket.send(
        encodeFrame({
          kind: EClientFrame.Hello,
          threadId: args.threadId,
          channelCursor: null,
          lastEventSeq: 0,
          protocol: CHANNEL_PROTOCOL_VERSION,
        }),
      )
    }
  })
