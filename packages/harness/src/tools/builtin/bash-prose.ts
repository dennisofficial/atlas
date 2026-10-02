import { readIdling, type PortExposure } from '@dltech/atlas-core'

import { MATCHED_LINES_CAP } from '../../shells/shell-watch'

export function bashDescription({
  defaultTimeoutMs,
  maximumTimeoutMs,
}: {
  defaultTimeoutMs: number
  maximumTimeoutMs: number
}): string {
  return [
    'Run a command in bash. Every call starts in the project directory; to run elsewhere, pass the',
    'directory as workdir rather than opening with cd - a cd moves only the process that runs it, and',
    'nothing carries between calls: a shell variable, background job or cd dies with the call.',
    'stdout and stderr come back as one string, all of stdout first, and only the tail is kept once',
    'output grows past the cap. A non-zero exit is reported with its code. Times out after',
    `${defaultTimeoutMs} ms unless timeoutMs says otherwise, never past ${maximumTimeoutMs} ms. Every`,
    'call carries a description: a few imperative words naming the job, which the developer reads in',
    'place of the command.',
    'Start a long-running command with runInBackground to get a shell id back at once; the shell',
    'outlives the turn that started it. A server - a dev server, a database, anything that listens',
    'until stopped - belongs on service_start instead. A watch pattern delivers matching lines as',
    'they arrive; match failure markers as well as success, since silence is indistinguishable from',
    'progress. A background shell that prints nothing for 30 minutes is killed; without checkInMs it',
    'wakes you only on its ending. Commands that wait idly - sleeps, poll loops, foreground watches,',
    'do-nothing ticks - are refused.',
    'shell_output reads a shell that will not end on its own, shell_list shows what is running, and',
    "shell_kill stops one. exposePort publishes a background server's port at runInBackground and",
    'answers with the *.sandbox.localhost URL to hand the operator; bind the server to 0.0.0.0 and',
    'never offer a localhost URL from a container.',
  ].join(' ')
}

export function exposureClause({ exposure }: { exposure: PortExposure | undefined }): readonly string[] {
  if (exposure === undefined) return []
  if (exposure.hostPort === exposure.containerPort) {
    return [`It is reachable on the operator’s machine at ${exposure.url}.`]
  }

  return [
    `It is reachable on the operator’s machine at ${exposure.url}, where a proxy forwards to port ${exposure.containerPort} in the sandbox.`,
    'Bind the server to 0.0.0.0 so the proxy can reach it.',
    'Use the returned URL on the operator’s machine; use the service’s internal address for checks inside the container.',
  ]
}

export const exposureNeedsBackground = (): string =>
  'exposePort publishes the port of a server that keeps running, so it needs runInBackground: true; a foreground command ends before anyone could open the URL'

export const exposureUnsupported = (): string =>
  'this execution mode cannot publish ports, so exposePort has nothing to bind'

export function watchClause({ watch }: { watch: string | undefined }): readonly string[] {
  if (watch === undefined) return []

  return [
    `Lines matching ${watch} reach you as they are printed, batched rather than one by one, and after`,
    `${MATCHED_LINES_CAP} of them the watch disarms and says so while the shell carries on.`,
    'A match neither consumes nor is consumed by shell_output.',
  ]
}

export function ceilingClause({ timeoutMs }: { timeoutMs: number | undefined }): readonly string[] {
  if (timeoutMs === undefined) return []

  return [`It is killed if it outlives ${timeoutMs} ms, and the killing reaches you as its ending.`]
}

export function checkInClause({ checkInMs }: { checkInMs: number | undefined }): readonly string[] {
  if (checkInMs === undefined) return []
  return [
    `While it runs, a check-in reaches you every ${checkInMs} ms with how long it has been up and its latest output,`,
    'so it can never sit running unnoticed - if that cadence would only nag, it belongs on service_start.',
  ]
}

const NATIVE_WAITS = 'gh run watch --exit-status, gh pr checks --watch'

export function noOpRefusal(): string {
  return [
    'this command does nothing: it would return at once with nothing printed and nothing changed, so the only thing calling it spends is the turn itself, and calling it again spends another.',
    'If the point was to wait on a background shell, a turn does not wait by calling tools - it waits by ending. End the turn with no tool call, and the shell ending, a watch match or the next check-in will wake you.',
    'If nothing is running the slow work yet, start it with runInBackground and a watch instead of ticking.',
  ].join(' ')
}

export function watchRefusal(): string {
  return [
    'this command only ends when what it watches ends, so in the foreground it holds the whole turn open for minutes nothing else can use.',
    'Start this exact command with runInBackground instead: its ending reaches you wherever you are with everything it printed, and a watch pattern naming both the outcome you want and the failures that would end the wait can wake you sooner.',
    'If the point was a one-shot look, run the one-shot form - gh run view, gh pr checks without --watch, tail without -f.',
  ].join(' ')
}

export function truncatedWatchRefusal(): string {
  return [
    'piping a CI watch through tail or head keeps only its last lines, and the lines that name a failing check are the ones that fall off - a green-looking tail has merged a red run before.',
    'Run the watch untruncated with runInBackground: its ending carries everything it printed, and when output grows past the cap the tail is what survives anyway.',
  ].join(' ')
}

export function idlingRefusal(args: { command: string; timeoutMs: number }): string {
  const idle = readIdling(args)
  if (idle.unbounded) {
    return `this loop has no end: it polls until the ${args.timeoutMs} ms timeout kills the turn, and nothing it could learn arrives sooner for the waiting. Start this exact command with runInBackground - give it a watch naming both the outcome you want and the failures that would end the wait, and timeoutMs as a ceiling - or drop the loop for the blocking wait the underlying tool already has, itself started with runInBackground: ${NATIVE_WAITS}`
  }

  const across = idle.iterations === undefined ? '' : ` across ${idle.iterations} iterations`
  return `this command spends ${idle.seconds} seconds asleep${across}, and nothing advances while it does. Start this exact command with runInBackground, whose ending is delivered to you wherever you are and which takes a watch to tell you about a matching line before then, or drop the poll for the blocking wait the underlying tool already has, itself started with runInBackground: ${NATIVE_WAITS}`
}
