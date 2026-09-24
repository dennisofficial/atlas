import { readIdling, type PortExposure } from '@dltech/atlas-core'

import { MATCHED_LINES_CAP } from '../../shells/shell-watch'

export function bashDescription({
  defaultTimeoutMs,
  maximumTimeoutMs,
  defaultCheckInMs,
}: {
  defaultTimeoutMs: number
  maximumTimeoutMs: number
  defaultCheckInMs: number
}): string {
  return [
    'Run a command in bash.',
    'Every call starts in the project directory.',
    'To run somewhere else, pass that directory as workdir rather than opening the command with a cd - a cd moves only the process that runs it, and that process ends with the call.',
    'A relative workdir resolves against the project directory.',
    'Good: workdir "packages/core" with command "bun test". Bad: command "cd packages/core && bun test".',
    'Nothing carries between calls: the process is new each time, so a shell variable, function, background job or cd dies with the call that made it.',
    'stdout and stderr come back as one string, all of stdout first and then all of stderr, so the two are not interleaved.',
    'Only the tail is kept once the output grows past its cap.',
    'A non-zero exit is reported rather than raised, with the code named at the end.',
    `Times out after ${defaultTimeoutMs} ms unless timeoutMs says otherwise, and never later than ${maximumTimeoutMs} ms.`,
    'Every call carries a description: a few imperative words naming the job - Run the core tests, Rebase onto main - which is what the developer reads in place of the command.',
    'A command that waits by sleeping is refused, a poll loop included: idling advances nothing, so start the slow thing with runInBackground - and where the tool has a blocking wait of its own, gh run watch --exit-status or gh pr checks --watch, that wait is the slow thing: run it in the background, never in the foreground, instead of looping a status query.',
    'A command that does nothing - true, :, a no-op run only to pass time while a background shell runs - is refused on the same grounds, and worse: it returns at once, so calling it in a loop spins the turn hundreds of times a minute. A turn never waits by calling tools; it waits by ending, and what wakes it afterwards is the background shell ending, a watch match, or a check-in.',
    'Set runInBackground to start a long-running command - a watch, a slow test suite - and get a shell id back at once instead of waiting.',
    'A server - a dev server, a database, anything that listens and stays up until stopped - is not a background shell: it belongs on service_start, which never times out and never holds the turn open.',
    'A watch that exits when what it watches finishes - gh run watch, a log tail - is a background shell, not a service, and never a foreground command: a foreground watch is refused on the same grounds as a sleep.',
    'A CI watch piped through tail or head is refused: truncating it hides the lines that name a failing check, and the ending of a background shell already carries everything it printed.',
    'A background shell starts in the same directory workdir names, interleaves stdout and stderr in arrival order, and outlives the turn that started it.',
    'It also survives an interrupt: stopping a turn stops the turn, not the shell, so nothing needs nohup, setsid, a detached subprocess or a sentinel file to stay alive - only shell_kill and the end of the session stop one.',
    'Its ending wakes you wherever you are, however it ends, carrying everything it printed - whether or not a turn is running when it lands. The one exception is a shell you stop yourself: shell_kill waits for the death and its result carries everything the shell printed, so no ending lands for it.',
    'Its stdin is closed, so a command that stops to ask something can never be answered and will never end; that too is delivered to you, so a prompt is reported rather than waited out.',
    'timeoutMs on a background shell is a ceiling rather than a wait: the shell is killed if it outlives it, that killing reaches you as an ending like any other, and a background ceiling is not held to the foreground cap.',
    `checkInMs paces the check-ins of a background shell: every checkInMs ms that it is still running you are woken with how long it has been up, when it last printed, and its latest output, so a shell that neither ends nor reports is never waited on indefinitely - the default is ${defaultCheckInMs} ms, a check-in kills nothing, and output never postpones one, since a poll loop printing a line a minute is exactly the shell nobody is watching.`,
    'watch takes a regular expression, tested against every line the shell prints, and hands you the matching lines as they arrive instead of only at the end; it requires runInBackground.',
    'Match what would end the wait either way, not only the ending you are hoping for: a watch set to the success marker alone stays silent through a crash, and silence from a watch is indistinguishable from progress.',
    'So widen the alternation rather than narrow it - completed|ERROR|Traceback|FAILED|panic|Killed - and a failure wakes you as fast as a pass does.',
    'Matching lines arrive batched, and they never move the shell_output cursor: a read does not consume a pending match, and a match does not consume what a read would have returned.',
    `After ${MATCHED_LINES_CAP} matched lines the watch disarms and says so; the shell keeps running and still delivers its ending.`,
    'So never wait on one: no sleeping, no polling, no idle loop, and no do-nothing call to tick the time away - ticking only spins the turn. Move on to other work, or end the turn and be woken.',
    'shell_output reads a shell that will not end on its own, shell_list shows what is running, and shell_kill stops one.',
    'exposePort publishes the port a background server listens on and answers with the URL to hand the operator; it requires runInBackground.',
    'In a container sandbox any port can be exposed: have the server listen on 0.0.0.0 - 127.0.0.1 is invisible outside the container - and pass the port it listens on; the reply carries the URL to hand the operator.',
  ].join(' ')
}

export function exposureClause({ exposure }: { exposure: PortExposure | undefined }): readonly string[] {
  if (exposure === undefined) return []
  if (exposure.hostPort === exposure.containerPort) {
    return [`It is reachable at ${exposure.url}.`]
  }

  return [
    `It is reachable from this machine at ${exposure.url}, where a proxy forwards to port ${exposure.containerPort} in the sandbox -`,
    'if the server bound 127.0.0.1 instead of 0.0.0.0 the proxy cannot reach it, so rebind before handing the URL over.',
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

export function checkInClause({ checkInMs }: { checkInMs: number }): readonly string[] {
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
