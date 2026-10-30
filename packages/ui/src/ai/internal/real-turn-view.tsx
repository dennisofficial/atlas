import { EToolKind, EToolState, Tool } from '../tool'
import { AgentMessage, UserMessage } from '../message'
import { MessageResponse } from '../message-response'
import { Reasoning } from '../reasoning'
import { Subagent } from '../subagent'
import { WorkSummary } from '../work-summary'
import type { RealSegment, RealSpawn, RealTurn, RealWorkItem } from './real-transcript'

const KINDS = Object.values(EToolKind) as string[]
const STATES = Object.values(EToolState) as string[]

const kindOf = (kind: string): EToolKind =>
  KINDS.includes(kind) ? (kind as EToolKind) : EToolKind.Shell
const stateOf = (state: string): EToolState =>
  STATES.includes(state) ? (state as EToolState) : EToolState.Done

function WorkItemView({ item }: { item: RealWorkItem }) {
  if (item.kind === 'thought') return <Reasoning text={item.text} />
  return (
    <>
      {item.calls.map((call) => (
        <Tool
          key={call.id}
          kind={kindOf(call.kind)}
          state={stateOf(call.state)}
          label={call.label}
          title={call.title}
          output={call.output}
          errorText={call.errorText}
          elapsed={call.elapsed}
        />
      ))}
    </>
  )
}

function SegmentView({ segment }: { segment: RealSegment }) {
  if (segment.kind === 'message') {
    return (
      <AgentMessage author="Atlas" caret={false} copyText={segment.text}>
        <MessageResponse caret="block">{segment.text}</MessageResponse>
      </AgentMessage>
    )
  }
  return (
    <WorkSummary duration={segment.duration} stepCount={segment.stepCount}>
      {segment.items.map((item) => (
        <WorkItemView key={item.id} item={item} />
      ))}
    </WorkSummary>
  )
}

function SpawnView({ spawn }: { spawn: RealSpawn }) {
  return (
    <Subagent
      name={spawn.name}
      elapsed={spawn.elapsed}
      prompt={spawn.brief}
      result={<MessageResponse>{spawn.result}</MessageResponse>}
      defaultOpen={false}
    />
  )
}

export function RealTurnView({ turn }: { turn: RealTurn }) {
  if (turn.kind === 'user') {
    return (
      <UserMessage>
        <MessageResponse>{turn.text}</MessageResponse>
      </UserMessage>
    )
  }
  const answer = turn.segments.at(-1)
  const final = answer?.kind === 'message' ? answer : null
  const body = final === null ? turn.segments : turn.segments.slice(0, -1)
  return (
    <div className="flex flex-col gap-4">
      {body.map((segment) => (
        <SegmentView key={segment.id} segment={segment} />
      ))}
      {turn.spawns.map((spawn) => (
        <SpawnView key={spawn.id} spawn={spawn} />
      ))}
      {final === null ? null : <SegmentView segment={final} />}
    </div>
  )
}
