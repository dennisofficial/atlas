import type { BootStepChild, BootStepView, BootView } from '@dltech/atlas-client/session'
import {
  EBootStepState,
  sandboxBootSummary,
  sandboxBootTitle,
} from '@dltech/atlas-ui/sandbox-boot-copy'
import { EBootStepState as EWireBootStepState } from '@dltech/atlas-wire/web'

const BOOT_STATE: Record<EWireBootStepState, EBootStepState> = {
  [EWireBootStepState.Pending]: EBootStepState.Pending,
  [EWireBootStepState.Running]: EBootStepState.Running,
  [EWireBootStepState.Done]: EBootStepState.Done,
  [EWireBootStepState.Error]: EBootStepState.Error,
  [EWireBootStepState.Interrupted]: EBootStepState.Interrupted,
}

export type BootChildDisplay = {
  id: string
  label: string
  state: EBootStepState
  detail?: string
}

export type BootStepDisplay = {
  id: string
  label: string
  state: EBootStepState
  detail?: string
  children?: readonly BootChildDisplay[]
  command?: string
  output?: string
}

export type BootDisplay = {
  title: string
  summary: string | undefined
  state: EBootStepState
  open: boolean
  headerError: string | undefined
  failed: boolean
  steps: readonly BootStepDisplay[]
}

const childOf = (child: BootStepChild): BootChildDisplay => ({
  id: child.id,
  label: child.label,
  state: BOOT_STATE[child.state],
  ...(child.detail === undefined ? {} : { detail: child.detail }),
})

const stepOf = (step: BootStepView): BootStepDisplay => ({
  id: step.id,
  label: step.label,
  state: BOOT_STATE[step.state],
  ...(step.detail === undefined ? {} : { detail: step.detail }),
  ...(step.children === undefined ? {} : { children: step.children.map(childOf) }),
  ...(step.command === undefined ? {} : { command: step.command }),
  ...(step.output === undefined ? {} : { output: step.output }),
})

const errorOf = (step: { state: EBootStepState; detail?: string }): string | undefined =>
  step.state === EBootStepState.Error ? step.detail : undefined

const carriesError = (step: BootStepDisplay): boolean =>
  errorOf(step) !== undefined || (step.children ?? []).some((child) => errorOf(child) !== undefined)

export const bootDisplayOf = (args: { view: BootView; now: number }): BootDisplay => {
  const { view, now } = args
  const elapsedMs =
    view.startedAtMs === undefined ? view.elapsedMs : Math.max(0, now - view.startedAtMs)
  const state = BOOT_STATE[view.state]
  const steps = view.steps.map(stepOf)
  const carried = steps.some(carriesError)
  return {
    title: view.title ?? sandboxBootTitle(state),
    summary: sandboxBootSummary({ steps, state, elapsedMs }),
    state,
    open:
      state === EBootStepState.Running ||
      state === EBootStepState.Interrupted ||
      state === EBootStepState.Error ||
      carried,
    headerError:
      state === EBootStepState.Error && view.error !== undefined && !carried
        ? view.error
        : undefined,
    failed: state === EBootStepState.Error,
    steps,
  }
}
