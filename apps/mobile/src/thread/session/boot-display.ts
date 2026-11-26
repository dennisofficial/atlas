import {
  bootViewAt,
  type BootStepChild,
  type BootStepView,
  type BootView,
} from '@dltech/atlas-client/session'
import {
  EBootStepState,
  sandboxBootDisplayOf,
  type SandboxBootDisplay,
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

export type BootDisplay = SandboxBootDisplay & {
  state: EBootStepState
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

export const bootDisplayOf = (args: { view: BootView; now: number }): BootDisplay => {
  const view = bootViewAt(args)
  const state = BOOT_STATE[view.state]
  const steps = view.steps.map(stepOf)
  return {
    ...sandboxBootDisplayOf({
      steps,
      state,
      title: view.title,
      elapsedMs: view.elapsedMs,
      error: view.error,
    }),
    state,
    steps,
  }
}
