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
      "This session runs in a sandbox that Atlas deletes when the session ends. The sandbox has its own filesystem, /tmp and localhost. These are not the operator's machine.",
    ]
  }
  if (placement === EExecutionLocation.Docker) {
    return [
      "This session runs on the operator's machine in a Docker sandbox. The sandbox shares only the project directory and its declared mounts with the operator's machine.",
    ]
  }
  return ["This session runs locally on the operator's machine, the host."]
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
