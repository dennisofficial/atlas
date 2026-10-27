import { NoopExecutionLocationSink, type ExecutionLocationSinkPort } from '@dltech/atlas-core'

import { AgentJournal } from './agent-journal'
import { ChildSteps } from './child-steps'
import { NoticeDelivery } from './delivery'
import type { SupervisorDeps } from './deps'
import { NoticeWake } from './notice-wake'
import { AgentNoticeQueue } from './notices'
import { ChildRecovery } from './recovery'
import type { Relocation } from './relocate-children'
import { AgentRoster } from './roster'
import { ChildSpawner } from './spawn-child'

export type SupervisorParts = {
  sink: ExecutionLocationSinkPort
  roster: AgentRoster
  notices: AgentNoticeQueue
  journal: AgentJournal
  steps: ChildSteps
  spawner: ChildSpawner
  noticeWake: NoticeWake
  delivery: NoticeDelivery
  recovery: ChildRecovery
  relocation: Relocation
}

export function wireSupervisor(args: SupervisorDeps): SupervisorParts {
  const sink = args.sink ?? new NoopExecutionLocationSink()
  const roster = new AgentRoster()
  const notices = new AgentNoticeQueue()
  const journal = new AgentJournal({ log: args.log, ids: args.ids })
  const steps = new ChildSteps({
    runners: args.runners,
    roster,
    notices,
    journal,
    clock: args.clock,
    ...(args.telemetry === undefined ? {} : { telemetry: args.telemetry }),
    ...(args.runningShell === undefined ? {} : { runningShell: args.runningShell }),
    ...(args.endShells === undefined ? {} : { endShells: args.endShells }),
    ...(args.leftServices === undefined ? {} : { leftServices: args.leftServices }),
    ...(args.inheritOrphanedNotices === undefined
      ? {}
      : { inheritOrphanedNotices: args.inheritOrphanedNotices }),
    ...(args.onChildEnded === undefined ? {} : { onEnded: args.onChildEnded }),
  })
  const spawner = new ChildSpawner({
    threads: args.threads,
    log: args.log,
    ids: args.ids,
    clock: args.clock,
    roster,
    steps,
    agentTypes: args.agentTypes,
    sink,
    deps: args,
  })
  const noticeWake = new NoticeWake({ roster, steps, agentTypes: args.agentTypes, deps: args })
  const delivery = new NoticeDelivery({ notices, roster, clock: args.clock })
  const recovery = new ChildRecovery({
    log: args.log,
    threads: args.threads,
    ids: args.ids,
    clock: args.clock,
    roster,
    notices,
    launchDirectory: args.launchDirectory,
  })
  const relocation: Relocation = { deps: args, sink, roster, steps, recovery, delivery }

  return {
    sink,
    roster,
    notices,
    journal,
    steps,
    spawner,
    noticeWake,
    delivery,
    recovery,
    relocation,
  }
}
