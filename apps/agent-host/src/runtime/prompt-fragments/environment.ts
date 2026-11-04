import { EExecutionLocation, PromptFragment, type PromptContext } from '@dltech/atlas-core'

import { localDayOf, localWeekdayOf } from './local-day'
import { VolatilePromptFragment } from './volatile'

export class TodayFragment extends VolatilePromptFragment {
  readonly id = 'environment.today'

  stamp(): string {
    return localDayOf(new Date().toISOString())
  }

  text(): string {
    const instant = new Date().toISOString()
    const day = localDayOf(instant)
    if (day === '') return ''

    const weekday = localWeekdayOf(instant)
    return `Today is ${weekday === '' ? day : `${weekday}, ${day}`}.`
  }
}

const placementLines = (placement: EExecutionLocation | undefined): readonly string[] => {
  if (placement === EExecutionLocation.Cloud) {
    return [
      "This session runs in a throwaway pod that lives exactly as long as the session; its filesystem, /tmp, and localhost are the pod's alone, not the operator's machine.",
    ]
  }
  if (placement === EExecutionLocation.Docker) {
    return [
      "This session is running on the operator's machine in a Docker container — the container shares only the project directory and its declared mounts with the host.",
    ]
  }
  return ["This session is running locally on the operator's machine (the host)."]
}

export class ExecutionLocationFragment extends VolatilePromptFragment {
  readonly id = 'environment.execution-location'

  stamp(ctx: PromptContext): string {
    return `${ctx.placement ?? ''}:${ctx.runner ?? ''}`
  }

  text(ctx: PromptContext): string {
    return placementLines(ctx.placement).join(' ')
  }
}
