import { EBootStepState } from '@dltech/atlas-wire/web'
import { EBootStepState as EUiBootState } from '@dltech/atlas-ui/ai/sandbox-boot'

import type { BootView } from './data/transcript'

const UI_STATE: Record<EBootStepState, EUiBootState> = {
  [EBootStepState.Pending]: EUiBootState.Pending,
  [EBootStepState.Running]: EUiBootState.Running,
  [EBootStepState.Done]: EUiBootState.Done,
  [EBootStepState.Error]: EUiBootState.Error,
}

export function sandboxBootPropsOf(view: BootView) {
  return {
    state: UI_STATE[view.state],
    steps: view.steps.map((step) => ({
      id: step.id,
      label: step.label,
      state: UI_STATE[step.state],
      ...(step.detail === undefined ? {} : { detail: step.detail }),
    })),
    ...(view.elapsedMs === undefined ? {} : { elapsedMs: view.elapsedMs }),
    ...(view.error === undefined ? {} : { error: view.error }),
  }
}

export const isBootStarting = (view: BootView | null): boolean =>
  view !== null &&
  (view.state === EBootStepState.Running || view.state === EBootStepState.Pending)
