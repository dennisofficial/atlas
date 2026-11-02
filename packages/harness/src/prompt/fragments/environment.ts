import {
  DEFAULT_CONTAINER_IDLE_MINUTES,
  EExecutionLocation,
  ERunner,
  PromptFragment,
  type ClockPort,
  type PromptContext,
} from '@dltech/atlas-core'

import { SystemClock } from '../../store/clock'
import { localDayOf, localWeekdayOf } from '../../time/local-day'
import { VolatilePromptFragment } from '../volatile'

export class TodayFragment extends VolatilePromptFragment {
  readonly id = 'environment.today'

  private readonly clock: ClockPort = new SystemClock()

  stamp(): string {
    return localDayOf(this.clock.now())
  }

  text(): string {
    const instant = this.clock.now()
    const day = localDayOf(instant)
    if (day === '') return ''

    const weekday = localWeekdayOf(instant)
    return `Today is ${weekday === '' ? day : `${weekday}, ${day}`}.`
  }
}

const POD_LINES = [
  "This session runs in a throwaway pod that lives exactly as long as the session: its filesystem, /tmp, and localhost are the pod's alone, and all of it is discarded when the session ends, so leave worktrees, clones, and scratch files in place when work finishes.",
  "The primary repository is at /atlas/workspaces/<repo-name>, with the project's configured repositories cloned beside it; clone others there too and use explicit workdir or absolute paths.",
  "Gitignored content (node_modules, .env) never reaches the pod, so run the project's own install before building, testing, or running it.",
  `After ${DEFAULT_CONTAINER_IDLE_MINUTES} minutes without activity Atlas parks the pod, which clears /tmp; anything that must survive a park goes under ATLAS_SESSION_DIR or /atlas/workspaces.`,
]

const LOCAL_POD_PORTS =
  "The service_start and bash exposePort options publish a port to the operator's machine as a loopback URL (http://<port>.sandbox.localhost:<host-port>/); bind the server to 0.0.0.0, not 127.0.0.1."

const placementLines = (args: {
  placement: EExecutionLocation | undefined
  runner: ERunner | undefined
}): readonly string[] => {
  const { placement } = args
  if (placement === EExecutionLocation.Cloud && args.runner === ERunner.Local) {
    return [...POD_LINES, LOCAL_POD_PORTS]
  }
  if (placement === EExecutionLocation.Cloud) return POD_LINES
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
    return placementLines({ placement: ctx.placement, runner: ctx.runner }).join(' ')
  }
}

export class SessionPathsFragment extends PromptFragment {
  readonly id = 'environment.session-paths'

  text(): string {
    return [
      'Every command sees three session directories: ATLAS_SESSION_DIR, shared by this conversation and its sub-agents and teammates;',
      'ATLAS_CONTEXT_DIR inside it, for the plans, decisions, coordination notes, and artifacts every thread reads;',
      'and ATLAS_THREAD_DIR, private to your own thread.',
      'Put temporary probes, seed scripts, and one-off downloads in $ATLAS_SESSION_DIR/scratch and private scratch in ATLAS_THREAD_DIR.',
      'Use these variables in bash commands or file-tool paths; Atlas resolves them for the calling thread.',
    ].join(' ')
  }
}
