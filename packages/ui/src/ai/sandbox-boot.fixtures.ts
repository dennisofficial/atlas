import { useCallback, useEffect, useState } from 'react'

import { EBootStepState, type SandboxBootProps, type SandboxBootStep } from './sandbox-boot'

export enum EBootOutcome {
  Ready = 'ready',
  CloneFails = 'clone-fails',
}

export const CLONE_ERROR = "Repository not found, or the GitHub connection can't read it."

const TICK_MS = 100
const CLONE_FAIL_AT = 0.62
const LOOP_PAUSE_MS = 2500

interface BootStepSpec {
  id: string
  label: string
  startMs: number
  durationMs: number
  detail: (progress: number) => string
}

const pct = (progress: number) => `${Math.round(progress * 100)}%`

const BOOT_STEP_SPECS: BootStepSpec[] = [
  {
    id: 'provision',
    label: 'Provisioning sandbox',
    startMs: 0,
    durationMs: 2800,
    detail: (p) => (p < 1 ? 'Vercel · iad1 · 4 vCPU' : 'Vercel · iad1 · 4 vCPU · ready'),
  },
  {
    id: 'serve',
    label: 'Downloading atlas-serve',
    startMs: 2800,
    durationMs: 4200,
    detail: (p) => `atlas-serve 0.42.1 · ${Math.round(p * 61)} / 61 MB`,
  },
  {
    id: 'clone',
    label: 'Cloning repository',
    startMs: 2800,
    durationMs: 6000,
    detail: (p) => `dennisofficial/atlas · main · ${pct(p)}`,
  },
  {
    id: 'context',
    label: 'Fetching skills & instructions',
    startMs: 2800,
    durationMs: 2400,
    detail: (p) =>
      p < 1 ? `${Math.round(p * 14)} of 14 files` : '12 skills · ATLAS.md · AGENTS.md',
  },
  {
    id: 'settings',
    label: 'Applying settings',
    startMs: 2800,
    durationMs: 1600,
    detail: (p) =>
      p < 1 ? 'workspace → user → project' : '31 settings · 9 secrets · 2 MCP servers',
  },
  {
    id: 'agent',
    label: 'Starting agent',
    startMs: 8800,
    durationMs: 1400,
    detail: (p) => (p < 1 ? 'composing harness' : 'listening on :4040'),
  },
]

const TOTAL_MS = Math.max(...BOOT_STEP_SPECS.map((spec) => spec.startMs + spec.durationMs))

const cloneSpec = BOOT_STEP_SPECS.find((spec) => spec.id === 'clone')
const FAILURE_MS = cloneSpec ? cloneSpec.startMs + CLONE_FAIL_AT * cloneSpec.durationMs : TOTAL_MS

interface StepAtInput {
  spec: BootStepSpec
  elapsedMs: number
  outcome: EBootOutcome
  halted: boolean
}

function stepAt({ spec, elapsedMs, outcome, halted }: StepAtInput): SandboxBootStep {
  const { id, label } = spec
  const raw = (elapsedMs - spec.startMs) / spec.durationMs
  const progress = Math.max(0, Math.min(1, raw))
  if (outcome === EBootOutcome.CloneFails && id === 'clone' && progress >= CLONE_FAIL_AT) {
    return { id, label, state: EBootStepState.Error, detail: CLONE_ERROR }
  }
  if (raw <= 0) return { id, label, state: EBootStepState.Pending, detail: 'Waiting' }
  if (halted && progress < 1)
    return { id, label, state: EBootStepState.Pending, detail: 'Cancelled' }
  const state = progress >= 1 ? EBootStepState.Done : EBootStepState.Running
  return { id, label, state, detail: spec.detail(progress) }
}

export type BootSnapshot = Pick<SandboxBootProps, 'steps' | 'state' | 'elapsedMs' | 'error'>

interface SnapshotInput {
  elapsedMs: number
  outcome?: EBootOutcome
}

export function bootSnapshot({
  elapsedMs,
  outcome = EBootOutcome.Ready,
}: SnapshotInput): BootSnapshot {
  const halted = outcome === EBootOutcome.CloneFails && elapsedMs >= FAILURE_MS
  const now = halted ? FAILURE_MS : Math.min(elapsedMs, TOTAL_MS)
  const steps = BOOT_STEP_SPECS.map((spec) => stepAt({ spec, elapsedMs: now, outcome, halted }))
  if (halted) return { steps, state: EBootStepState.Error, elapsedMs: now, error: CLONE_ERROR }
  const state = now >= TOTAL_MS ? EBootStepState.Done : EBootStepState.Running
  return { steps, state, elapsedMs: now }
}

export const RUNNING_SNAPSHOT = bootSnapshot({ elapsedMs: 4400 })
export const READY_SNAPSHOT = bootSnapshot({ elapsedMs: TOTAL_MS })
export const CLONE_FAILS_SNAPSHOT = bootSnapshot({
  elapsedMs: TOTAL_MS,
  outcome: EBootOutcome.CloneFails,
})

export function useBootSimulation(outcome: EBootOutcome): BootSnapshot & { retry: () => void } {
  const [elapsedMs, setElapsedMs] = useState(0)
  const snapshot = bootSnapshot({ elapsedMs, outcome })
  const failed = snapshot.state === EBootStepState.Error
  const done = snapshot.state === EBootStepState.Done

  const retry = useCallback(() => setElapsedMs(0), [])

  useEffect(() => {
    if (failed || done) return
    const timer = setInterval(() => setElapsedMs((ms) => ms + TICK_MS), TICK_MS)
    return () => clearInterval(timer)
  }, [failed, done])

  useEffect(() => {
    if (!done) return
    const timer = setTimeout(retry, LOOP_PAUSE_MS)
    return () => clearTimeout(timer)
  }, [done, retry])

  return { ...snapshot, retry }
}
