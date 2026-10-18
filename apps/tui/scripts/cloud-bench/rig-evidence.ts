import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export enum EVerdict {
  Pass = 'PASS',
  Fail = 'FAIL',
  NotRun = 'NOT RUN',
  Untrusted = 'UNTRUSTED',
}

export type Observation = {
  at: string
  step: string
  view: string | null
  phase: string | null
  stamps: string | null
  provider: string | null
  note?: string | undefined
}

export type ScenarioFailure = { step: string; expected: string; observed: string }

export type ScenarioEvidence = {
  id: number
  slug: string
  title: string
  commands: string[]
  observations: Observation[]
  logs: { label: string; text: string }[]
  verdict: EVerdict
  failure?: ScenarioFailure | undefined
  reason?: string | undefined
}

export type Redactor = { hold: (secret: string) => void; redact: (text: string) => string }

const REDACTED = '<redacted>'
const MIN_HELD_SECRET_LENGTH = 8
const TRUSTED_PROTOCOL = 25
const DEV_VERSION_PREFIX = 'dev-'
const ABSENT_CELL = '—'

export function createRedactor(): Redactor {
  const held = new Set<string>()
  return {
    hold: (secret) => {
      const value = secret.trim()
      if (value.length < MIN_HELD_SECRET_LENGTH) return
      held.add(value)
    },
    redact: (text) => {
      const longestFirst = [...held].sort((left, right) => right.length - left.length)
      const scrubbed = longestFirst.reduce((current, secret) => current.split(secret).join(REDACTED), text)
      return scrubbed
        .replace(/team_[A-Za-z0-9]+/g, `team_${REDACTED}`)
        .replace(/prj_[A-Za-z0-9]+/g, `prj_${REDACTED}`)
        .replace(/bearer[\s.:=]+\S+/gi, `Bearer ${REDACTED}`)
    },
  }
}

const cell = (value: string | null | undefined): string => {
  if (value === null || value === undefined || value.length === 0) return ABSENT_CELL
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ⏎ ')
}

const tableRow = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`

const observationTable = (observations: readonly Observation[]): string => {
  const header = ['at', 'step', 'view', 'record phase', 'stamps', 'provider', 'note']
  const rows = observations.map((row) =>
    tableRow([row.at, row.step, row.view, row.phase, row.stamps, row.provider, row.note].map(cell)),
  )
  return [tableRow(header), tableRow(header.map(() => '---')), ...rows].join('\n')
}

const fenced = (text: string): string => {
  const longestTickRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longestTickRun + 1))
  return [`${fence}text`, text.trimEnd(), fence].join('\n')
}

const failureBlock = (failure: ScenarioFailure): string =>
  [
    '## Failure',
    `- failing step: ${failure.step}`,
    `- expected: ${failure.expected}`,
    `- observed: ${failure.observed}`,
  ].join('\n')

export function renderEvidence(args: { evidence: ScenarioEvidence; redact: (text: string) => string }): string {
  const { evidence } = args
  const sections: string[] = [`# Scenario ${evidence.id} — ${evidence.title}`, `Verdict: **${evidence.verdict}**`]
  if (evidence.reason !== undefined) sections.push(`## Reason\n${evidence.reason}`)
  if (evidence.failure !== undefined) sections.push(failureBlock(evidence.failure))
  if (evidence.commands.length > 0) {
    sections.push(
      `## Commands\n${evidence.commands.map((command, index) => `${index + 1}. ${command}`).join('\n')}`,
    )
  }
  if (evidence.observations.length > 0) sections.push(`## Observations\n${observationTable(evidence.observations)}`)
  for (const log of evidence.logs) sections.push(`## ${log.label}\n${fenced(log.text)}`)
  return args.redact(`${sections.join('\n\n')}\n`)
}

export async function writeEvidence(args: {
  dir: string
  evidence: ScenarioEvidence
  redactor: Redactor
}): Promise<string> {
  await mkdir(args.dir, { recursive: true })
  const path = join(args.dir, `scenario-${args.evidence.id}-${args.evidence.slug}.md`)
  await writeFile(path, renderEvidence({ evidence: args.evidence, redact: args.redactor.redact }))
  return path
}

export function trustOf(args: { version: string | null; protocol: number | null }): {
  trusted: boolean
  reason: string
} {
  if (args.version === null) return { trusted: false, reason: 'the serve version stamp was never read' }
  if (args.protocol === null) return { trusted: false, reason: 'the serve protocol stamp was never read' }
  if (!args.version.startsWith(DEV_VERSION_PREFIX)) {
    return { trusted: false, reason: `serve ${args.version} is a released build, not a ${DEV_VERSION_PREFIX} build` }
  }
  if (args.protocol !== TRUSTED_PROTOCOL) {
    return { trusted: false, reason: `serve speaks protocol ${args.protocol}, expected ${TRUSTED_PROTOCOL}` }
  }
  return { trusted: true, reason: `serve ${args.version} on protocol ${TRUSTED_PROTOCOL}` }
}

export function sawInOrder(args: { timeline: readonly string[]; states: readonly string[] }): boolean {
  let matched = 0
  for (const state of args.timeline) {
    if (matched === args.states.length) return true
    if (state === args.states[matched]) matched += 1
  }
  return matched === args.states.length
}

export class ScenarioFailed extends Error {
  readonly failure: ScenarioFailure

  constructor(failure: ScenarioFailure) {
    super(`${failure.step}: expected ${failure.expected}, observed ${failure.observed}`)
    this.name = 'ScenarioFailed'
    this.failure = failure
  }
}
