import { EExecutionLocation, PromptFragment, type ClockPort, type PromptContext } from '@dltech/atlas-core'

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

const placementLine = (placement: EExecutionLocation | undefined): string => {
  if (placement === EExecutionLocation.Cloud) {
    return 'This session is running in the cloud — a Vercel sandbox; your filesystem, /tmp, and localhost are the sandbox\'s alone, not the operator\'s machine.'
  }
  if (placement === EExecutionLocation.Docker) {
    return 'This session is running on the operator\'s machine in a Docker container — the container shares only the project directory and its declared mounts with the host.'
  }
  return 'This session is running locally on the operator\'s machine (the host).'
}

export class ExecutionLocationFragment extends VolatilePromptFragment {
  readonly id = 'environment.execution-location'

  stamp(ctx: PromptContext): string {
    return ctx.placement ?? ''
  }

  text(ctx: PromptContext): string {
    return [
      placementLine(ctx.placement),
      'New cloud workspaces place the primary repository at /atlas/workspaces/<repo-name>.',
      'Clone additional repositories beside it under /atlas/workspaces and use explicit workdir or absolute paths to work in them.',
      'Adjacent clones are ephemeral; sandbox cleanup deletes them.',
      'Gitignored content (node_modules, .env) does not reach a cloud sandbox, so run the project\'s own install before building, testing, or running it there.',
    ].join(' ')
  }
}

export class SessionPathsFragment extends PromptFragment {
  readonly id = 'environment.session-paths'

  text(): string {
    return [
      'Every command you run sees ATLAS_SESSION_DIR, the directory shared by this conversation and its sub-agents and teammates,',
      'ATLAS_CONTEXT_DIR, a folder inside it for plans, decisions, and working notes durable for the whole session and readable by every thread in it,',
      'and ATLAS_THREAD_DIR, a directory private to your own thread.',
      'These directories live and die with the session and move with it across cloud lifts.',
      'Keep temporary probes, seed scripts, and one-off downloads in $ATLAS_SESSION_DIR/scratch.',
      'Keep private scratch under ATLAS_THREAD_DIR.',
      'Keep plans, decisions, coordination notes, and supporting artifacts under ATLAS_CONTEXT_DIR.',
      'Use these variables in Bash commands or file-tool paths; Atlas resolves them for the calling thread.',
    ].join(' ')
  }
}
