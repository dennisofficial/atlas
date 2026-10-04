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
      'Atlas runs locally or in cloud.',
      'Local sessions execute commands and file operations on the host or in Docker.',
      'Cloud sessions run the harness and execution in a Vercel sandbox; the terminal is a client.',
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
      'Keep scratch files, probes, seed scripts, and one-off downloads in $ATLAS_SESSION_DIR/scratch - never loose in the Atlas home directory or the repository.',
      'Keep private scratch under ATLAS_THREAD_DIR and anything the session should keep under ATLAS_CONTEXT_DIR, rather than in the repository.',
      'Use these variables in Bash commands or file-tool paths; Atlas resolves them for the calling thread.',
    ].join(' ')
  }
}
