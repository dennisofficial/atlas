import { EKilledBy, type ThreadId } from '@dltech/atlas-core'
import {
  serviceLogTail,
  type ServiceRegistryPort,
  type ShellRegistryPort,
} from '@dltech/atlas-harness'
import {
  EClientRequest,
  ensureDeclaredServicesParamsSchema,
  killShellParamsSchema,
  readServiceLogParamsSchema,
  readShellOutputParamsSchema,
  restartServiceParamsSchema,
  startShellParamsSchema,
  stopServiceParamsSchema,
} from '@dltech/atlas-wire'

import {
  answeredRequest,
  refusedRequest,
  type ReplyFrame,
  type RequestFrame,
} from './request-reply'

export type ServeProcesses = {
  shells: Pick<ShellRegistryPort, 'start' | 'peek' | 'kill'>
  services: Pick<ServiceRegistryPort, 'list' | 'stop' | 'declared' | 'ensureDeclared' | 'restart'>
  cwd: string
}

const PROCESS_OPS: ReadonlySet<EClientRequest> = new Set([
  EClientRequest.StartShell,
  EClientRequest.ReadShellOutput,
  EClientRequest.KillShell,
  EClientRequest.StopService,
  EClientRequest.ReadServiceLog,
  EClientRequest.ListDeclaredServices,
  EClientRequest.EnsureDeclaredServices,
  EClientRequest.RestartService,
])

export const isProcessOp = (op: EClientRequest): boolean => PROCESS_OPS.has(op)

type Answer = (args: {
  frame: RequestFrame
  threadId: ThreadId
  processes: ServeProcesses
}) => Promise<ReplyFrame> | ReplyFrame

const startShell: Answer = async ({ frame, threadId, processes }) => {
  const parsed = startShellParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'start-shell wants { threadId, command, description, cwd? }',
    })
  }
  const outcome = await processes.shells.start({
    command: parsed.data.command,
    description: parsed.data.description,
    threadId,
    cwd: parsed.data.cwd ?? processes.cwd,
  })
  return answeredRequest({ replyTo: frame.id, data: outcome })
}

const readShellOutput: Answer = async ({ frame, threadId, processes }) => {
  const parsed = readShellOutputParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'read-shell-output wants { threadId, shellId, characters }',
    })
  }
  const { shellId, characters } = parsed.data
  const text = await processes.shells.peek({ shellId, characters, threadId })
  if (text === undefined) {
    return answeredRequest({
      replyTo: frame.id,
      data: {
        ok: false,
        reason: `no background shell is registered as "${shellId}" for this conversation`,
      },
    })
  }
  return answeredRequest({ replyTo: frame.id, data: { ok: true, text } })
}

const killShell: Answer = async ({ frame, threadId, processes }) => {
  const parsed = killShellParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'kill-shell wants { threadId, shellId }',
    })
  }
  const outcome = await processes.shells.kill({
    shellId: parsed.data.shellId,
    threadId,
    by: EKilledBy.User,
  })
  const data = outcome.ok ? { ok: true, snapshot: outcome.snapshot } : outcome
  return answeredRequest({ replyTo: frame.id, data })
}

const stopService: Answer = async ({ frame, processes }) => {
  const parsed = stopServiceParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'stop-service wants { serviceId }',
    })
  }
  const outcome = await processes.services.stop({
    serviceId: parsed.data.serviceId,
    by: EKilledBy.User,
  })
  const data = outcome.ok ? { ok: true, snapshot: outcome.snapshot } : outcome
  return answeredRequest({ replyTo: frame.id, data })
}

const readServiceLog: Answer = ({ frame, processes }) => {
  const parsed = readServiceLogParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'read-service-log wants { serviceId, characters }',
    })
  }
  const text = serviceLogTail({ services: processes.services, ...parsed.data })
  return answeredRequest({ replyTo: frame.id, data: { text } })
}

const listDeclaredServices: Answer = async ({ frame, processes }) => {
  if (processes.services.declared === undefined) {
    return answeredRequest({
      replyTo: frame.id,
      data: { ok: false, reason: 'this session does not track declared services' },
    })
  }
  const view = await processes.services.declared()
  return answeredRequest({ replyTo: frame.id, data: { ok: true, view } })
}

const ensureDeclaredServices: Answer = async ({ frame, threadId, processes }) => {
  const parsed = ensureDeclaredServicesParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'ensure-declared-services wants { names? }',
    })
  }
  if (processes.services.ensureDeclared === undefined) {
    return answeredRequest({
      replyTo: frame.id,
      data: { ok: false, reason: 'this session cannot start declared services' },
    })
  }
  const results = await processes.services.ensureDeclared({
    threadId,
    names: parsed.data.names,
  })
  return answeredRequest({ replyTo: frame.id, data: { ok: true, results } })
}

const restartService: Answer = async ({ frame, processes }) => {
  const parsed = restartServiceParamsSchema.safeParse(frame.params)
  if (!parsed.success) {
    return refusedRequest({
      replyTo: frame.id,
      message: 'restart-service wants { serviceId }',
    })
  }
  if (processes.services.restart === undefined) {
    return answeredRequest({
      replyTo: frame.id,
      data: { ok: false, reason: 'this session cannot restart services' },
    })
  }
  const outcome = await processes.services.restart({ serviceId: parsed.data.serviceId })
  return answeredRequest({ replyTo: frame.id, data: outcome })
}

const ANSWERS: Partial<Record<EClientRequest, Answer>> = {
  [EClientRequest.StartShell]: startShell,
  [EClientRequest.ReadShellOutput]: readShellOutput,
  [EClientRequest.KillShell]: killShell,
  [EClientRequest.StopService]: stopService,
  [EClientRequest.ReadServiceLog]: readServiceLog,
  [EClientRequest.ListDeclaredServices]: listDeclaredServices,
  [EClientRequest.EnsureDeclaredServices]: ensureDeclaredServices,
  [EClientRequest.RestartService]: restartService,
}

export const answerProcessRequest = async (args: {
  frame: RequestFrame
  threadId: ThreadId
  processes: ServeProcesses
}): Promise<ReplyFrame> => {
  const answer = ANSWERS[args.frame.op]
  if (answer === undefined) {
    return refusedRequest({
      replyTo: args.frame.id,
      message: `${args.frame.op} is not a process-control op`,
    })
  }
  return await answer(args)
}

export const routeProcessRequest = (args: {
  frame: RequestFrame
  threadId: ThreadId
  processes: ServeProcesses | undefined
  reply: (reply: ReplyFrame) => void
}): boolean => {
  const { frame, threadId, processes, reply } = args
  if (!isProcessOp(frame.op)) return false
  if (processes === undefined) {
    reply(
      refusedRequest({
        replyTo: frame.id,
        message: 'this serve holds no process registries',
      }),
    )
    return true
  }
  void answerProcessRequest({ frame, threadId, processes })
    .catch((error: unknown) =>
      refusedRequest({
        replyTo: frame.id,
        message: error instanceof Error ? error.message : `the ${frame.op} request failed`,
      }),
    )
    .then(reply)
  return true
}
