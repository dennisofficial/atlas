import { ECallStatus, type ServiceInfo } from '@dltech/atlas-protocol'

import type { HandoffContext } from '../../testing/handoff-suite'
import { callIdOf, podCall } from './fault-support'

export const CALL_ID = 'c1'

export const dispatchesOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-dispatched' && callIdOf(row) === CALL_ID)

export const resultsOf = async (ctx: HandoffContext) =>
  (await ctx.events()).filter((row) => row.type === 'tool-result' && callIdOf(row) === CALL_ID)

export const interruptedOf = (row: { event: unknown }): boolean => {
  const event = row.event as { interrupted?: boolean; error?: { message: string } }
  if (event.interrupted === true) return true
  return event.error !== undefined && /interrupt/i.test(event.error.message)
}

export type ResultEvent = {
  output?: { serviceId?: string }
  error?: { message: string }
}

export const resultOf = async (ctx: HandoffContext): Promise<ResultEvent> => {
  const [first] = await resultsOf(ctx)
  if (first === undefined) throw new Error('the service call reported no result')
  return first.event as ResultEvent
}

export const startedIdsOf = async (ctx: HandoffContext): Promise<readonly string[]> =>
  (await ctx.record())
    .filter((row) => row.type === 'service-started')
    .map((row) => (row.event as { serviceId: string }).serviceId)

export const podServices = async (ctx: HandoffContext): Promise<readonly ServiceInfo[]> => {
  const listed = await podCall({
    rig: ctx.rig,
    url: ctx.daemon.url,
    sessionId: ctx.sessionId,
    op: { op: 'services.list' },
  })
  if (listed.status !== ECallStatus.Ok || listed.op !== 'services.list') {
    throw new Error(`the pod refused to list its services: ${JSON.stringify(listed)}`)
  }
  return listed.value
}

export const stopInPod = async (args: {
  ctx: HandoffContext
  serviceId: string
}): Promise<void> => {
  const stopped = await podCall({
    rig: args.ctx.rig,
    url: args.ctx.daemon.url,
    sessionId: args.ctx.sessionId,
    op: { op: 'services.stop', serviceId: args.serviceId },
  })
  if (stopped.status !== ECallStatus.Ok) {
    throw new Error(`the pod refused to stop ${args.serviceId}: ${JSON.stringify(stopped)}`)
  }
}

export const listeningCommandOf = (args: { started: string; runs: string; gate: string }): string =>
  `touch ${args.started}; echo run >> ${args.runs}; cat ${args.gate}; exec bun -e 'Bun.serve({ port: Number(process.env.PORT), fetch: () => new Response("ok") })'`

export const serviceStartCallOf = (args: {
  command: string
  description: string
  workdir: string
  port: number
}) => ({
  callId: CALL_ID,
  name: 'service',
  input: {
    action: 'start',
    command: args.command,
    description: args.description,
    workdir: args.workdir,
    port: args.port,
    readyTimeoutMs: 60_000,
  },
})
