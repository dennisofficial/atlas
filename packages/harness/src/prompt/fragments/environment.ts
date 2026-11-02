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
  "This session runs in a throwaway pod. Its filesystem, /tmp, and localhost belong to the pod, not the operator's machine.",
  'The primary repository is at /atlas/workspaces/<repo-name>, and repositories the project configures are cloned beside it; clone others there too and use explicit workdir or absolute paths to work in them.',
  "Gitignored content (node_modules, .env) does not reach the pod, so run the project's own install before building, testing, or running it.",
  `After ${DEFAULT_CONTAINER_IDLE_MINUTES} minutes without activity Atlas parks the pod, and parking clears /tmp; keep anything that must outlast a pause under ATLAS_SESSION_DIR or /atlas/workspaces.`,
  'The whole pod is discarded with the session, so leave worktrees, clones, and scratch files in place when work finishes.',
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
      'Every command you run sees ATLAS_SESSION_DIR, the directory shared by this conversation and its sub-agents and teammates,',
      'ATLAS_CONTEXT_DIR, a folder inside it for plans, decisions, and working notes durable for the whole session and readable by every thread in it,',
      'and ATLAS_THREAD_DIR, a directory private to your own thread.',
      'These directories live and die with the session.',
      'Keep temporary probes, seed scripts, and one-off downloads in $ATLAS_SESSION_DIR/scratch.',
      'Keep private scratch under ATLAS_THREAD_DIR.',
      'Keep plans, decisions, coordination notes, and supporting artifacts under ATLAS_CONTEXT_DIR.',
      'Use these variables in Bash commands or file-tool paths; Atlas resolves them for the calling thread.',
    ].join(' ')
  }
}
