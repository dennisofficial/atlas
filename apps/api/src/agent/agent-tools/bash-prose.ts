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
    'Run a command in bash. Every call starts in the project directory. To run a command elsewhere, pass the',
    'directory as workdir rather than opening with cd. A cd moves only the process that runs it, and',
    'nothing carries between calls: a shell variable, a background job or a cd dies with the call.',
    'stdout and stderr come back as one string, all of stdout first. Only the tail is kept once the',
    'output grows past the cap. A non-zero exit is reported with its code. A call times out after',
    `${defaultTimeoutMs} ms unless timeoutMs says otherwise, and never past ${maximumTimeoutMs} ms.`,
    'Every call carries a description: a few imperative words naming the job, which the operator reads in',
    'place of the command.',
    'Background bash is for finite jobs: builds, test runs, installs, migrations. It is not for servers that',
    'run until stopped. Start a declared service with `service` action `start` and a name. Start a one-off server with `service` action `start` and a command.',
    'Start a slow command with runInBackground to get a shell id back at once. The shell',
    'outlives the turn that started it, and it reconnects after the Atlas harness restarts. Full background output',
    'is saved in the session folder of the owning thread; read the returned output path, or grep it.',
    `shell_input writes to the stdin of a durable shell. ${ATLAS_SESSION_DIR_ENV} and ${ATLAS_CONTEXT_DIR_ENV} name`,
    `the session directories shared by the session, its sub-agents and its teammates.`,
    `${ATLAS_THREAD_DIR_ENV} names the thread directory private to the calling thread.`,
    `Put scratch files, probes and one-off downloads in $${ATLAS_SESSION_DIR_ENV}/scratch. Never put them loose in the Atlas home directory.`,
    'The output file does not rotate. A 5 GiB kernel file-size limit bounds regular-file writes for background commands.',
    'A server - a dev server, a database, anything that listens',
    'until stopped - belongs on `service` action `start` instead, which also publishes its port. A watch pattern delivers matching lines as',
    'they arrive. Match the failure markers as well as the success markers: a watch that matches only',
    'success cannot tell a slow command from a failed one. A background shell that prints nothing for 30 minutes is killed, and that ending wakes',
    'you like any other. Commands that wait idly - sleeps, poll loops, foreground watches,',
    'do-nothing ticks - are refused.',
    'shell_output reads a shell that will not end on its own. shell_list shows what is running. shell_kill stops one.',
  ].join(' ')
}

export function watchClause({ watch }: { watch: string | undefined }): readonly string[] {
  if (watch === undefined) return []

  return [
    `Lines matching ${watch} reach you as they are printed, batched rather than one by one. After`,
    `${MATCHED_LINES_CAP} of them the watch disarms and says so, and the shell carries on.`,
    'A match neither consumes nor is consumed by shell_output.',
  ]
}

export function ceilingClause({ timeoutMs }: { timeoutMs: number | undefined }): readonly string[] {
  if (timeoutMs === undefined) return []

  return [
    `The shell is killed if it outlives ${timeoutMs} ms. The killing reaches you as its ending.`,
  ]
}

export const MATCHED_LINES_CAP = 200

const NATIVE_WAITS = 'gh run watch --exit-status, gh pr checks --watch'

export function noOpRefusal(): string {
  return [
    'this command does nothing: it returns at once with nothing printed and nothing changed. The only thing the call spends is the turn itself, and a second call spends another turn.',
    'A turn does not wait by calling tools. It waits by ending: end the turn with no tool call, and the shell ending or a watch match will wake you.',
    'If nothing is running the slow work yet, start it with runInBackground and a watch instead of ticking.',
  ].join(' ')
}

export function watchRefusal(): string {
  return [
    'this command only ends when what it watches ends, so in the foreground it holds the whole turn open for minutes that nothing else can use.',
    'Start this exact command with runInBackground instead. Its ending reaches you with an output excerpt and the full log path. A watch pattern naming both the outcome you want and the failures that would end the wait can wake you sooner.',
    'If the point was a one-shot look, run the one-shot form: gh run view, gh pr checks without --watch, tail without -f.',
  ].join(' ')
}

export function truncatedWatchRefusal(): string {
  return [
    'piping a CI watch through tail or head keeps only its last lines, and the lines that name a failing check are the ones that fall off. A truncated tail previously led to a merge despite a failed CI run.',
    'Run the watch untruncated with runInBackground. Its ending carries an output excerpt and the path to the complete spool, so the failing lines remain available through Read or Grep.',
  ].join(' ')
}

export function idlingRefusal(args: { command: string; timeoutMs: number }): string {
  const idle = readIdling(args)
  if (idle.unbounded) {
    return `this loop has no end: it polls until the ${args.timeoutMs} ms timeout kills the turn, and nothing it could learn arrives sooner for the waiting. Start this exact command with runInBackground: give it a watch naming both the outcome you want and the failures that would end the wait, and timeoutMs as a ceiling. Otherwise drop the loop for the blocking wait the underlying tool already has, itself started with runInBackground: ${NATIVE_WAITS}`
  }

  const across = idle.iterations === undefined ? '' : ` across ${idle.iterations} iterations`
  return `this command spends ${idle.seconds} seconds asleep${across}, and nothing advances while it does. Start this exact command with runInBackground: its ending is delivered to you wherever you are, and a watch tells you about a matching line before then. Otherwise drop the poll for the blocking wait the underlying tool already has, itself started with runInBackground: ${NATIVE_WAITS}`
}
