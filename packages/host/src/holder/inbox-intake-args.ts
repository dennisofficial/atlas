import type {
  EResumeOutcome,
  EventDraft,
  ModelPort,
  PluginEventBody,
  RecordBody,
  RecordEvent,
  RunId,
  ThreadId,
} from '@dltech/atlas-core'
import type { ControlPlane } from '@dltech/atlas-control'
import type { CommandRegistry } from '@dltech/atlas-commands'
import type { PodSlash } from '@dltech/atlas-plugin-sdk'
import type { LogPort } from '@dltech/atlas-observability'

import { CommandIntake, type CommandHandlers, type ControlHandlers } from './command-intake'
import type { EIntakeScope } from './intake-scope'
import type { OperatorAnswerIntake } from './operator-answer'
import type { SessionRecord } from './record/record-adapter'

export type InboxIntakeArgs = {
  plane: ControlPlane
  sessionId: string
  record: SessionRecord
  threadId: ThreadId
  runId: () => RunId
  scope: EIntakeScope
  commands?: CommandRegistry | undefined
  handlers?: CommandHandlers | undefined
  controlHandlers?: ControlHandlers | undefined
  slash?: PodSlash | undefined
  model?: ModelPort | undefined
  childrenRunning?: (() => number) | undefined
  operatorAnswers?: OperatorAnswerIntake | undefined
  crewRunning?: (() => number) | undefined
  crew?: { resume(args: { agentId: string }): Promise<EResumeOutcome> } | undefined
  mainThreadId?: string | undefined
  log?: LogPort | undefined
  now?: (() => number) | undefined
}

export const commandIntakeOf = ({
  args,
  logEvents,
  append,
}: {
  args: InboxIntakeArgs
  logEvents: () => RecordEvent[]
  append: (drafts: readonly (EventDraft | RecordBody | PluginEventBody)[]) => Promise<void>
}): CommandIntake | undefined => {
  if (args.commands === undefined) return undefined
  return new CommandIntake({
    plane: args.plane,
    commands: args.commands,
    handlers: args.handlers ?? new Map(),
    controlHandlers: args.controlHandlers ?? new Map(),
    slash: args.slash,
    sessionId: args.sessionId,
    model: args.model,
    visibleEvents: () => args.record.eventCache().visibleLoopEvents(),
    logEvents,
    ...(args.crew === undefined ? {} : { crew: args.crew }),
    ...(args.mainThreadId === undefined ? {} : { mainThreadId: args.mainThreadId }),
    ...(args.childrenRunning === undefined ? {} : { childrenRunning: args.childrenRunning }),
    loggedEvents: logEvents,
    append,
    log: args.log,
  })
}
