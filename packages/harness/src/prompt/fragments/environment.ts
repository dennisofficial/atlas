import { PromptFragment, type ClockPort } from '@dltech/atlas-core'

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

export class ExecutionLocationFragment extends PromptFragment {
  readonly id = 'environment.execution-location'

  text(): string {
    return [
      "This session is running in a pod or a Vercel sandbox; your filesystem, /tmp, and localhost are the sandbox's alone, not the operator's machine.",
      'New cloud workspaces place the primary repository at /atlas/workspaces/<repo-name>.',
      'Repositories the project configures are already cloned beside it; clone others there too and use explicit workdir or absolute paths to work in them.',
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
      'These directories live and die with the session.',
      'Keep temporary probes, seed scripts, and one-off downloads in $ATLAS_SESSION_DIR/scratch.',
      'Keep private scratch under ATLAS_THREAD_DIR.',
      'Keep plans, decisions, coordination notes, and supporting artifacts under ATLAS_CONTEXT_DIR.',
      'Use these variables in Bash commands or file-tool paths; Atlas resolves them for the calling thread.',
    ].join(' ')
  }
}
