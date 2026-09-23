import { EExecutionLocation, PromptFragment, type ClockPort, type PromptContext } from '@dltech/atlas-core'

import { SystemClock } from '../../store/clock'
import { localDayOf, localWeekdayOf } from '../../time/local-day'
import { VolatilePromptFragment } from '../volatile'

export class ProjectDirectoryFragment extends PromptFragment {
  readonly id = 'environment.project-directory'

  text(ctx: PromptContext): string {
    return [
      `The project directory is ${ctx.projectDirectory}, and every bash command starts there.`,
      'You are already in it, so never spend a cd returning to it, and run somewhere else by passing that directory as workdir rather than by cd.',
    ].join(' ')
  }
}

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

export class RelativePathsFragment extends PromptFragment {
  readonly id = 'environment.relative-paths'

  text(): string {
    return [
      'A path you pass to a tool resolves against the project directory, so write those relative to it.',
      'A tool path may reference environment variables such as $TMPDIR and may start with ~; both expand for you, and a variable that is not set comes back as an error.',
      'A path inside a bash command is resolved by the shell instead, against workdir or the project directory, so write those absolute.',
    ].join(' ')
  }
}

export class ExecutionLocationFragment extends VolatilePromptFragment {
  readonly id = 'environment.execution-location'

  constructor(private readonly current: () => EExecutionLocation | undefined) {
    super()
  }

  stamp(): string {
    return this.current() ?? EExecutionLocation.Host
  }

  text(): string {
    const location = this.current() ?? EExecutionLocation.Host
    if (location === EExecutionLocation.Host) {
      return [
        'This session runs its tools on the host machine, and it can also run them inside a Docker container sandbox.',
        'Call execution_location with location "docker" to move the whole session, sub-agents included — prefer that before starting dev servers, installing dependencies or running test suites you want kept off the host, and move back with "host" when the work needs the machine itself.',
      ].join(' ')
    }
    if (location === EExecutionLocation.Docker) {
      return [
        'This session runs its tools inside a Docker container sandbox.',
        'Call execution_location with location "host" to move the whole session back onto the host machine when the work needs it.',
      ].join(' ')
    }
    return [
      'This session runs its tools inside a cloud sandbox, not the operator’s machine, and it cannot move itself to the host or into Docker — moving to or from the cloud is the operator’s call.',
      'A port it publishes through service_start’s exposePort is reachable at a URL the operator can open, not at a local address, since the two of you share no machine.',
      'The workspace arrived with a lift baseline commit ("atlas: lifted workspace baseline"). Commit ON TOP of it and never rewrite history past it — no reset, rebase, or amend that orphans it — because the descend keys on its SHA, and losing it strands this session in the cloud.',
    ].join(' ')
  }
}
