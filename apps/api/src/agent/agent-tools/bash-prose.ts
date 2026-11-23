import { readIdling } from '@dltech/atlas-core'

import {
  ATLAS_CONTEXT_DIR_ENV,
  ATLAS_SESSION_DIR_ENV,
  ATLAS_THREAD_DIR_ENV,
} from '../runtime/session-paths'

export function bashDescription({
  defaultTimeoutMs,
  maximumTimeoutMs,
}: {
  defaultTimeoutMs: number
  maximumTimeoutMs: number
}): string {
  return [
    'Run a command in bash. Every call starts in the project directory. To run elsewhere, pass workdir rather',
    'than opening with cd. Nothing carries between calls: a shell variable, a background job or a cd dies',
    'with the call. stdout and stderr come back as one string, all of stdout first, and only the tail is kept',
    'past the cap. A non-zero exit reports its code. A call waits',
    `${defaultTimeoutMs} ms for the command unless timeoutMs says otherwise, and never past ${maximumTimeoutMs} ms.`,
    'A command still running at that window is not killed: it continues as a background shell, and the call',
    'returns at once with the output so far and that shellId. Use shell_output and shell_kill',
    'with it, or wait for its ending.',
    'Every call carries a description: a few imperative words naming the job, which the operator reads in',
    'place of the command.',
    '`background: true` starts the command and returns its shellId at once, for a long job you do not wait',
    'on. timeoutMs then kills it past that ceiling. Its stdin is closed unless input is true: set input for a',
    'CLI that asks for input, and answer it with shell_input. input implies background.',
    'Background bash is for finite jobs: builds, test runs, installs, migrations. It is not for a server that',
    'runs until stopped; start one with `service` action `start`, which also publishes its port.',
    `${ATLAS_SESSION_DIR_ENV} and ${ATLAS_CONTEXT_DIR_ENV} name`,
    `the session directories shared by the session, its sub-agents and its teammates.`,
    `${ATLAS_THREAD_DIR_ENV} names the thread directory private to the calling thread.`,
    `Put scratch files, probes and one-off downloads in $${ATLAS_SESSION_DIR_ENV}/scratch, never loose in the Atlas home directory.`,
    'Commands that wait idly - sleeps, poll loops, foreground watches, do-nothing ticks - are refused.',
    'shell_output reads a shell that will not end on its own. shell_list shows what is running.',
  ].join(' ')
}

export function ceilingClause({ timeoutMs }: { timeoutMs: number | undefined }): readonly string[] {
  if (timeoutMs === undefined) return []

  return [
    `The shell is killed if it outlives ${timeoutMs} ms. The killing reaches you as its ending.`,
  ]
}

const NATIVE_WAITS = 'gh run watch --exit-status, gh pr checks --watch'

export function noOpRefusal(): string {
  return [
    'this command does nothing: it returns at once with nothing printed and nothing changed. The only thing the call spends is the turn itself, and a second call spends another turn.',
    'A turn does not wait by calling tools. It waits by ending: end the turn with no tool call, and the shell ending will wake you.',
    'If nothing is running the slow work yet, start it with `background: true` instead of ticking.',
  ].join(' ')
}

export function watchRefusal(): string {
  return [
    'this command only ends when what it watches ends, so in the foreground it holds the whole turn open for minutes that nothing else can use.',
    'Start this exact command with `background: true` instead. Its ending reaches you with an output excerpt and the full log path.',
    'If the point was a one-shot look, run the one-shot form: gh run view, gh pr checks without --watch, tail without -f.',
  ].join(' ')
}

export function truncatedWatchRefusal(): string {
  return [
    'piping a CI watch through tail or head keeps only its last lines, and the lines that name a failing check are the ones that fall off. A truncated tail previously led to a merge despite a failed CI run.',
    'Run the watch untruncated with `background: true`. Its ending carries an output excerpt and the path to the complete spool, so the failing lines remain available through Read or Grep.',
  ].join(' ')
}

export function idlingRefusal(args: { command: string; timeoutMs: number }): string {
  const idle = readIdling(args)
  if (idle.unbounded) {
    return `this loop has no end: it polls until the ${args.timeoutMs} ms timeout kills the turn, and nothing it could learn arrives sooner for the waiting. Start this exact command with \`background: true\`: give it timeoutMs as a ceiling. Otherwise drop the loop for the blocking wait the underlying tool already has, itself started with \`background: true\`: ${NATIVE_WAITS}`
  }

  const across = idle.iterations === undefined ? '' : ` across ${idle.iterations} iterations`
  return `this command spends ${idle.seconds} seconds asleep${across}, and nothing advances while it does. Start this exact command with \`background: true\`: its ending is delivered to you wherever you are. Otherwise drop the poll for the blocking wait the underlying tool already has, itself started with \`background: true\`: ${NATIVE_WAITS}`
}
