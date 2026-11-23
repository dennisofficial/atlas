import { isTeammateType } from '../../agents/kind'
import { agentLabel } from '../../agents/label'
import { systemNotice } from '../../context/envelope'
import { agentEnding, countedNoun, EAgentStatus } from '../../agents/status'
import { NO_CONTENT_TEXT } from '../../events/empty-step'
import type { Event, EventOfType } from '../../events/envelope'
import { isNoticeArrival } from '../../events/notice-stage'
import { ERunFailureKind } from '../../events/run-failure'
import { EKilledBy } from '../../shells/status'
import type { AssembledMessage } from '../assembled'
import { defineRule, type Rule } from '../rule'

const REPORTED_NOTHING = 'It reported nothing.'

const NO_REPLY_CONTENT =
  'It ended with no text. The provider dropped its end-turn message even after the Atlas harness retried the request and nudged it, so the harness ended the turn cleanly instead of failing the thread. There is no answer here to act on. Send it a message to try again. Otherwise compensate for what it never delivered. Do not treat this as a quiet success.'

const USER_STOPPED =
  'The operator stopped this sub-agent deliberately. You did not stop it, and nothing went wrong with it. Do not spawn it again to finish its work unless the operator asks.'

const LOST_AGENT =
  'Nobody stopped this sub-agent. The session it ran in went away before it could report. What it says here is only what it had said by then. Whatever it was doing may be half-applied. Its thread is intact, so check the work before you redo any of it. Let the operator decide whether to resume it.'

const RELOCATED =
  'This sub-agent was not stopped. The session moved where it runs, and the sub-agent is resuming there. It will report again when the real ending arrives.'

const RETRY = 'Send it a message to retry it: a message restarts it with its thread intact.'

const WEDGED =
  'Its thread is corrupt: prompt assembly fails on every step, so a message cannot restart it. The harness will not retry it. Spawn a fresh sub-agent for anything still outstanding.'

const LOST_CONTINUES =
  'Its host could not continue it. Its thread is intact, so a message resumes its work, and spawning it again gives you a fresh one that finishes the same job instead.'

const wedged = (event: Ending): boolean =>
  event.status === EAgentStatus.Failed && event.failureKind === ERunFailureKind.ExchangeFault

const retryAdvice = (event: Ending): readonly string[] =>
  (event.status === EAgentStatus.Failed || event.status === EAgentStatus.Stopped) &&
  event.killedBy !== EKilledBy.ContainerSwitch &&
  !wedged(event)
    ? [RETRY]
    : []

const failedCauseAdvice = (event: Ending): readonly string[] => {
  if (event.status !== EAgentStatus.Failed || event.failureCause === undefined) return []
  if (event.failureKind === ERunFailureKind.Lost) return [LOST_CONTINUES]
  if (wedged(event)) {
    return [`It failed on this error, not on its work: ${event.failureCause} ${WEDGED}`]
  }
  return [
    `It failed on this error, not on its work: ${event.failureCause} Respawning the same sub-agent the same way usually fails the same way. Fix the cause, switch models, or do that work yourself.`,
  ]
}

const NOT_YOUR_HISTORY =
  'None of their own steps are in your history, and none are coming. What each one reports here is all of it.'

type Ending = EventOfType<'agent-ended'>

const reportOf = (event: Ending): string => {
  const prose = event.prose.trim()
  return prose === '' ? REPORTED_NOTHING : prose
}

const noContentAdvice = (event: Ending): readonly string[] =>
  event.prose.trim() === NO_CONTENT_TEXT ? [NO_REPLY_CONTENT] : []

function advice(event: Ending): readonly string[] {
  if (event.status === 'paused' || event.killedBy === EKilledBy.ContainerSwitch) {
    return [RELOCATED, ...noContentAdvice(event)]
  }
  if (event.killedBy === EKilledBy.User) {
    return [USER_STOPPED, ...retryAdvice(event), ...noContentAdvice(event)]
  }
  if (event.killedBy === EKilledBy.Unrecorded) {
    return [LOST_AGENT, ...retryAdvice(event), ...noContentAdvice(event)]
  }
  return [...failedCauseAdvice(event), ...retryAdvice(event), ...noContentAdvice(event)]
}

const leftServicesAdvice = (event: Ending): readonly string[] =>
  event.leftServices === undefined || event.leftServices.length === 0
    ? []
    : [
        `It left ${countedNoun({ count: event.leftServices.length, noun: 'service' })} running, and you own ${event.leftServices.length === 1 ? 'it' : 'them'} now: ${event.leftServices.join('; ')}. Stop ${event.leftServices.length === 1 ? 'it' : 'them'} with \`service\` action \`stop\` when you no longer need ${event.leftServices.length === 1 ? 'it' : 'them'}.`,
      ]

function sectionOf(event: Ending): string {
  const named = `${event.agentId} ${agentLabel(event)}`
  const subject = isTeammateType(event.agentType) ? named : `Sub-agent ${named}`
  const headline = `${subject} ${agentEnding(event)}.`
  return [headline, ...advice(event), ...leftServicesAdvice(event), reportOf(event)].join('\n\n')
}

export function agentEndingsText({ endings }: { endings: readonly Ending[] }): string {
  const roster = `${countedNoun({ count: endings.length, noun: 'agent' })} you spawned ended. ${NOT_YOUR_HISTORY}`

  return systemNotice({
    kind: 'agents-ended',
    content: [roster, ...endings.map(sectionOf)].join('\n\n'),
  })
}

const carriesEnding = (event: Event): event is Ending =>
  event.type === 'agent-ended' && event.relayed !== false && !isNoticeArrival(event)

function answersOpenCall(
  merged: readonly AssembledMessage[],
  next: AssembledMessage | undefined,
): next is AssembledMessage {
  if (next === undefined || next.message.role !== 'tool') return false
  const last = merged.at(-1)
  return (
    last !== undefined &&
    last.message.role === 'assistant' &&
    last.message.content.some((part) => part.type === 'tool-call')
  )
}

function mergeBySeq({
  messages,
  blocks,
}: {
  messages: readonly AssembledMessage[]
  blocks: readonly AssembledMessage[]
}): readonly AssembledMessage[] {
  const merged: AssembledMessage[] = []
  let index = 0

  for (const block of blocks) {
    while (index < messages.length) {
      const next = messages[index]
      if (next === undefined || next.origin.seq > block.origin.seq) break
      merged.push(next)
      index += 1
    }

    let late = messages[index]
    while (answersOpenCall(merged, late)) {
      merged.push(late)
      index += 1
      late = messages[index]
    }

    merged.push(block)
  }

  return [...merged, ...messages.slice(index)]
}

function blockOf(event: Ending): AssembledMessage {
  return {
    message: {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: agentEndingsText({ endings: [event] }) }],
    },
    origin: { eventId: event.id, seq: event.seq },
  }
}

export function agentEndingsBlock(): Rule {
  return defineRule({
    name: 'agentEndingsBlock',
    apply: (input, ctx) => {
      const blocks = ctx.events.filter(carriesEnding).map((event) => blockOf(event))
      if (blocks.length === 0) return input

      return { system: input.system, messages: mergeBySeq({ messages: input.messages, blocks }) }
    },
  })
}
