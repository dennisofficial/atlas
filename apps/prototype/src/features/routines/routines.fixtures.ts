export const NOW = '2026-11-10T07:04:00Z'

export enum ERoutineOutcome {
  Started = 'started',
  Settled = 'settled',
  SkippedBusy = 'skipped-busy',
  Skipped = 'skipped',
  Failed = 'failed',
}

export enum ERoutineState {
  Working = 'working',
  Idle = 'idle',
  Skipped = 'skipped',
  Off = 'off',
}

export interface AppRoutineRun {
  id: string
  at: string
  outcome: ERoutineOutcome
  durationMs?: number
  sessionId?: string
  note?: string
}

export interface AppRoutineCurrentRun {
  sessionId: string
  startedAt: string
  state: ERoutineState
}

export interface AppRoutine {
  id: string
  name: string
  projectId: string
  prompt: string
  cron: string
  schedule: string
  short: string
  timezone: string
  model: string
  enabled: boolean
  nextRunAt: string
  upcoming: readonly string[]
  lastOutcome: ERoutineOutcome
  currentRun?: AppRoutineCurrentRun
  runs: readonly AppRoutineRun[]
}

export const stateOf = (routine: AppRoutine): ERoutineState => {
  if (!routine.enabled) return ERoutineState.Off
  if (routine.currentRun !== undefined) return ERoutineState.Working
  if (routine.lastOutcome === ERoutineOutcome.SkippedBusy) return ERoutineState.Skipped
  return ERoutineState.Idle
}

export const findRoutine = (routineId: string): AppRoutine | undefined =>
  ROUTINES.find((routine) => routine.id === routineId)

const unit = (minutes: number): string => {
  if (minutes < 60) return `${minutes}m`
  if (minutes < 2160) return `${Math.round(minutes / 60)}h`
  return `${Math.round(minutes / 1440)}d`
}

export const relativeOf = ({ from, to }: { from: string; to: string }): string => {
  const minutes = Math.round((Date.parse(to) - Date.parse(from)) / 60_000)
  const magnitude = Math.abs(minutes)
  if (magnitude < 1) return 'now'
  return minutes > 0 ? `in ${unit(magnitude)}` : `${unit(magnitude)} ago`
}

const clockOf = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })

export const clockAt = clockOf

export const dayAt = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  })

export const minutesBetween = ({ from, to }: { from: string; to: string }): number =>
  (Date.parse(to) - Date.parse(from)) / 60_000

export const durationOf = (ms: number | undefined): string => {
  if (ms === undefined) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

const deadCodePrompt = [
  'Sweep `packages/*/src` and `apps/*/src` for code nothing references: exported symbols with no importer, files with no importer, and branches behind flags that no longer exist.',
  '',
  'For each hit, prove it is dead with the search you ran and the build or test that still passes without it. Remove what you proved, one commit per removal, and open a PR whose body lists every removal with its evidence, and every candidate you left alone with the reason.',
  '',
  'Do not refactor live code to make a removal easier. If nothing is dead, say so and open no PR.',
].join('\n')

const flakePrompt = [
  'Run the integration suite five times on `main`. For each flaky spec, record the failing seed and the diff of the two runs.',
  '',
  'Open one PR per spec whose flake you can explain; leave the rest in the PR description as a list of suspects.',
].join('\n')

export const ROUTINES: readonly AppRoutine[] = [
  {
    id: 'rte-dead-code',
    name: 'Dead code sweep',
    projectId: 'atlas',
    prompt: deadCodePrompt,
    cron: '0 7 * * 1-5',
    schedule: 'Every weekday at 07:00',
    short: 'Weekdays 07:00',
    timezone: 'Europe/London',
    model: 'opus-5-5',
    enabled: true,
    nextRunAt: '2026-11-11T07:00:00Z',
    upcoming: ['2026-11-11T07:00:00Z', '2026-11-12T07:00:00Z', '2026-11-13T07:00:00Z'],
    lastOutcome: ERoutineOutcome.Started,
    currentRun: {
      sessionId: 'ses-routine-dead-code',
      startedAt: '2026-11-10T07:00:00Z',
      state: ERoutineState.Working,
    },
    runs: [
      {
        id: 'run-1',
        at: '2026-11-10T07:00:00Z',
        outcome: ERoutineOutcome.Started,
        sessionId: 'ses-routine-dead-code',
      },
      {
        id: 'run-2',
        at: '2026-11-09T07:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 372_000,
        sessionId: 'ses-routine-dead-code-2',
      },
      {
        id: 'run-3',
        at: '2026-11-06T07:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 194_000,
        sessionId: 'ses-routine-dead-code-3',
      },
      {
        id: 'run-4',
        at: '2026-11-05T07:00:00Z',
        outcome: ERoutineOutcome.SkippedBusy,
        note: 'previous run still working',
      },
      {
        id: 'run-5',
        at: '2026-11-04T07:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 288_000,
        sessionId: 'ses-routine-dead-code-5',
      },
    ],
  },
  {
    id: 'rte-dep-audit',
    name: 'Dependency audit',
    projectId: 'atlas',
    prompt:
      'Audit `bun.lock` for direct dependencies nothing imports. For each, show the import search that found nothing and the typecheck that still passes after removal. Open one PR with the removals and a table of the evidence.',
    cron: '0 9 * * *',
    schedule: 'Every day at 09:00',
    short: 'Daily 09:00',
    timezone: 'Europe/London',
    model: 'sonnet-4-6',
    enabled: true,
    nextRunAt: '2026-11-10T09:00:00Z',
    upcoming: ['2026-11-10T09:00:00Z', '2026-11-11T09:00:00Z'],
    lastOutcome: ERoutineOutcome.Settled,
    runs: [
      {
        id: 'run-6',
        at: '2026-11-09T09:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 214_000,
        sessionId: 'ses-routine-dep-audit-1',
      },
      {
        id: 'run-7',
        at: '2026-11-08T09:00:00Z',
        outcome: ERoutineOutcome.Failed,
        durationMs: 41_000,
        note: 'sandbox boot timed out',
      },
      {
        id: 'run-8',
        at: '2026-11-07T09:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 176_000,
        sessionId: 'ses-routine-dep-audit-3',
      },
    ],
  },
  {
    id: 'rte-flake-check',
    name: 'Nightly flake check',
    projectId: 'rs-crm',
    prompt: flakePrompt,
    cron: '0 3 * * 1',
    schedule: 'Every Monday at 03:00',
    short: 'Mondays 03:00',
    timezone: 'Europe/London',
    model: 'sonnet-4-6',
    enabled: true,
    nextRunAt: '2026-11-16T03:00:00Z',
    upcoming: ['2026-11-16T03:00:00Z'],
    lastOutcome: ERoutineOutcome.Settled,
    runs: [
      {
        id: 'run-9',
        at: '2026-11-09T03:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 1_242_000,
        sessionId: 'ses-routine-flake-1',
      },
      {
        id: 'run-10',
        at: '2026-11-02T03:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 986_000,
        sessionId: 'ses-routine-flake-2',
      },
    ],
  },
  {
    id: 'rte-inbox-triage',
    name: 'Inbox triage',
    projectId: 'atlas',
    prompt:
      'Read every unread thread in my inbox. Group them by project, summarise what waits on me in one line each, and draft the replies to the ones I can answer without new information.',
    cron: '30 8 * * *',
    schedule: 'Every day at 08:30',
    short: 'Daily 08:30',
    timezone: 'Europe/London',
    model: 'sonnet-4-6',
    enabled: false,
    nextRunAt: '2026-11-10T08:30:00Z',
    upcoming: ['2026-11-10T08:30:00Z'],
    lastOutcome: ERoutineOutcome.Skipped,
    runs: [
      {
        id: 'run-11',
        at: '2026-11-07T08:30:00Z',
        outcome: ERoutineOutcome.Skipped,
        note: 'routine disabled before dispatch',
      },
    ],
  },
  {
    id: 'rte-release-notes',
    name: 'Release notes draft',
    projectId: 'comp-v2',
    prompt:
      'Read every merged PR since the last release tag. Write the release notes under the `Unreleased` heading: one line per user-visible change, grouped by area, with a link to the PR. Skip chores and dependency bumps. Open a PR against `docs/releases.md`.',
    cron: '0 17 * * 5',
    schedule: 'Every Friday at 17:00',
    short: 'Fridays 17:00',
    timezone: 'Europe/London',
    model: 'sonnet-4-6',
    enabled: true,
    nextRunAt: '2026-11-13T17:00:00Z',
    upcoming: ['2026-11-13T17:00:00Z'],
    lastOutcome: ERoutineOutcome.Settled,
    runs: [
      {
        id: 'run-12',
        at: '2026-11-06T17:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 428_000,
        sessionId: 'ses-routine-release-1',
      },
    ],
  },
  {
    id: 'rte-token-budget',
    name: 'Weekly token budget',
    projectId: 'csa',
    prompt:
      'Read the last 7 days of model usage. Report spend per model and per session, the three most expensive sessions with what they were doing, and anything that spent more than twice its usual. Post it as a markdown comment on `#eng-metrics`.',
    cron: '0 8 * * 1',
    schedule: 'Every Monday at 08:00',
    short: 'Mondays 08:00',
    timezone: 'Europe/London',
    model: 'gpt-5-codex',
    enabled: true,
    nextRunAt: '2026-11-16T08:00:00Z',
    upcoming: ['2026-11-16T08:00:00Z'],
    lastOutcome: ERoutineOutcome.Settled,
    runs: [
      {
        id: 'run-13',
        at: '2026-11-09T08:00:00Z',
        outcome: ERoutineOutcome.Settled,
        durationMs: 96_000,
        sessionId: 'ses-routine-budget-1',
      },
    ],
  },
]

export const SCHEDULE_PREVIEW = {
  human: 'Every weekday at 07:00',
  occurrences: ['Wed 11 Nov, 07:00', 'Thu 12 Nov, 07:00', 'Fri 13 Nov, 07:00'],
  perMonth: 21,
}
