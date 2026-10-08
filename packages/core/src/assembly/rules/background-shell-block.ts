import { systemNotice } from '../../context/envelope'
import type { EventOfType } from '../../events/envelope'
import { elapsedPhrase } from '../../shells/elapsed'
import { shellLabel } from '../../shells/label'
import type { ShellEventContext } from '../../shells/lifecycle'
import { EKilledBy, shellEnding } from '../../shells/status'

const PRINTED_NOTHING = 'It printed nothing.'

type Ending = Parameters<typeof shellEnding>[0]

const finalOutputNote = (ending: Ending): string =>
  `[This process is no longer running: it ${shellEnding(ending)}. What follows is its final, complete output — not a snapshot of a live job. Do not wait for it, poll it, or expect more from it.]`

const USER_KILLED =
  'The user stopped this shell deliberately. Nothing is wrong; do not restart it, work around it, or spend another run reproducing what it was doing unless the user asks.'

const droppedNote = (characters: number): string =>
  `[${characters} characters were lost before this point: the shell printed faster than it was read.]`

const remainingNote = (args: { characters: number; shellId: string }): string =>
  `[${args.characters} more characters are waiting — call shell_output({ shellId: "${args.shellId}" }) for the rest.]`

const OUTPUT_TAIL_CHARACTERS = 8_000

type OutputPointer = {
  outputPath?: string | undefined
  outputStart?: number | undefined
  outputEnd?: number | undefined
}

const pathOf = (args: { event: OutputPointer; context: ShellEventContext | undefined }): string | undefined =>
  args.event.outputPath ?? args.context?.started?.outputPath

const outputPathNote = (args: { path: string; event: OutputPointer }): string => {
  const { path, event } = args
  const range =
    event.outputStart !== undefined && event.outputEnd !== undefined
      ? ` Recorded source range: bytes ${event.outputStart} to ${event.outputEnd} of that file; the text shown here is an excerpt of it.`
      : ''
  return `Full output is saved at ${path}.${range} Use read or grep on that path for anything not shown here.`
}

function cappedTail(output: string): string[] {
  const text = output.trimEnd()
  if (text.length <= OUTPUT_TAIL_CHARACTERS) return [text === '' ? PRINTED_NOTHING : text]
  return [
    `[Only the last ${OUTPUT_TAIL_CHARACTERS} of ${text.length} characters are shown.]`,
    text.slice(-OUTPUT_TAIL_CHARACTERS),
  ]
}

const alreadyEnded = (args: { event: { shellId: string; command: string; description?: string | undefined }; ended: NonNullable<ShellEventContext['endedBefore']> }): string =>
  `Background shell ${args.event.shellId} ${shellLabel(args.event)} had already ended before this was recorded: it ${shellEnding(args.ended)}. Its ending appears earlier in this conversation. The shell is not running, there is nothing to wait for, and no further input or check-in can reach it.`

export function backgroundShellBlock(
  event: EventOfType<'background-shell-ended'>,
  context?: ShellEventContext,
): string {
  const path = pathOf({ event, context })
  const printed = path === undefined ? 'Everything it printed follows' : 'The end of what it printed follows'
  const headline = `Background shell ${event.shellId} ${shellLabel(event)} ${shellEnding(event)}. ${printed}; it has not been read yet.`

  const sections = [headline]

  if (event.killedBy === EKilledBy.User) sections.push(USER_KILLED)

  if (event.droppedCharacters > 0) sections.push(droppedNote(event.droppedCharacters))

  sections.push(finalOutputNote(event))

  if (path === undefined) {
    sections.push(event.output.trimEnd() === '' ? PRINTED_NOTHING : event.output.trimEnd())
    if (event.remainingCharacters > 0) {
      sections.push(remainingNote({ characters: event.remainingCharacters, shellId: event.shellId }))
    }
  } else {
    sections.push(...cappedTail(event.output))
    sections.push(outputPathNote({ path, event }))
  }

  return systemNotice({ kind: 'background-shell-ended', content: sections.join('\n\n') })
}

const AWAITING_WITHOUT_STDIN =
  'Its stdin is closed, so nothing can answer it and it will never end on its own. Use shell_input when input is supported; otherwise re-run it noninteractively (shell_kill the stuck one first). Waiting changes nothing: no ending is coming.'

const AWAITING_WITH_STDIN =
  'Answer it with shell_input({ shellId }), or stop it with shell_kill. It stays alive, waiting, until one of those happens.'

export function backgroundShellAwaitingInputBlock(
  event: EventOfType<'background-shell-awaiting-input'>,
  context?: ShellEventContext,
): string {
  const ended = context?.endedBefore
  if (ended !== undefined) {
    return systemNotice({ kind: 'background-shell-awaiting-input', content: alreadyEnded({ event, ended }) })
  }

  const supported = event.inputSupported === true
  const path = pathOf({ event, context })
  const headline = `Background shell ${event.shellId} ${shellLabel(event)} is waiting on input. Everything it has printed that you have not seen follows.`

  const sections = [headline]

  if (event.droppedCharacters > 0) sections.push(droppedNote(event.droppedCharacters))

  if (path === undefined) {
    sections.push(event.output.trimEnd() === '' ? PRINTED_NOTHING : event.output.trimEnd())
    if (event.remainingCharacters > 0) {
      sections.push(remainingNote({ characters: event.remainingCharacters, shellId: event.shellId }))
    }
  } else {
    sections.push(...cappedTail(event.output))
    sections.push(outputPathNote({ path, event }))
  }

  sections.push(supported ? AWAITING_WITH_STDIN : AWAITING_WITHOUT_STDIN)

  return systemNotice({ kind: 'background-shell-awaiting-input', content: sections.join('\n\n') })
}

const MATCHED_NOTHING = 'It carried no lines with it.'

const MATCH_IS_A_SNAPSHOT =
  'A match is a record of what the shell printed at that moment. It does not say whether the shell is running now; an ending, when there is one, arrives as its own message.'

const coverageNote = (pattern: string): string =>
  `These are only the lines matching /${pattern}/. Everything else the shell printed is not here, so nothing above rules out a failure the pattern does not name. Silence from this watch is not evidence that the run is healthy.`

const WATCH_DISARMED =
  'The watch has stopped: this shell matched the most lines a watch is allowed to carry, so no further matches will be reported. That says nothing about the shell itself.'

const matchedLineCount = (count: number): string =>
  count === 1 ? '1 line' : `${count} lines`

export function backgroundShellMatchedBlock(
  event: EventOfType<'background-shell-matched'>,
  context?: ShellEventContext,
): string {
  const headline = `Background shell ${event.shellId} ${shellLabel(event)}: watch matched ${matchedLineCount(event.matchCount)}.`

  const ended = context?.endedBefore
  const sections = [headline, ended === undefined ? MATCH_IS_A_SNAPSHOT : alreadyEnded({ event, ended })]

  sections.push(event.lines.trimEnd() === '' ? MATCHED_NOTHING : event.lines.trimEnd())

  sections.push(coverageNote(event.pattern))

  if (event.watchDisarmed === true) sections.push(WATCH_DISARMED)

  const path = pathOf({ event, context })
  if (path !== undefined) sections.push(outputPathNote({ path, event }))

  return systemNotice({ kind: 'background-shell-matched', content: sections.join('\n\n') })
}

const STILL_RUNNING_NOT_ENDED =
  'This is a scheduled check-in, not an ending: the shell is still running, and when it ends you will be told, along with everything it printed.'

const stillRunningExits = (shellId: string): string =>
  `Three ways out: read it with shell_output({ shellId: "${shellId}" }) to see how it is doing, stop it with shell_kill({ shellId: "${shellId}" }), or - if it is meant to stay up, like a dev server or a watcher - kill it and start it again with service_start, which never times out and never asks for attention. If it is making progress and simply needs the time, do nothing.`

export function backgroundShellStillRunningBlock(
  event: EventOfType<'background-shell-still-running'>,
  context?: ShellEventContext,
): string {
  const ended = context?.endedBefore
  if (ended !== undefined) {
    return systemNotice({ kind: 'background-shell-still-running', content: alreadyEnded({ event, ended }) })
  }

  const headline = `Background shell ${event.shellId} ${shellLabel(event)} has been running for ${elapsedPhrase(event.runningForMs)} and has not ended. ${STILL_RUNNING_NOT_ENDED}`

  const sections = [headline]

  if (event.silentForMs >= event.runningForMs) {
    sections.push('It has printed nothing in all that time.')
  } else {
    sections.push(`It last printed ${elapsedPhrase(event.silentForMs)} ago.`)
  }

  const tail = event.tail.trimEnd()
  if (tail !== '') sections.push(`Its most recent output:\n${tail}`)

  sections.push(stillRunningExits(event.shellId))
  sections.push(`These check-ins repeat every ${elapsedPhrase(event.checkInMs)} for as long as the shell runs.`)

  return systemNotice({ kind: 'background-shell-still-running', content: sections.join('\n\n') })
}
