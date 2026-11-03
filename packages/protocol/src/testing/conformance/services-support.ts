import { expect } from 'bun:test'

import { EServiceRunStatus, type ServiceInfo } from '../../ops'
import type { DaemonSession } from '../client'
import { connectAt, okValue, runToEnd, type DaemonHandle } from './support'

export const freePort = async (): Promise<number> => {
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data: () => {} },
  })
  const port = listener.port
  listener.stop(true)
  return port
}

export const startOp = (args: {
  serviceId: string
  command: string
  cwd: string
  port?: number | undefined
  readyTimeoutMs?: number | undefined
}) => ({
  op: 'services.start' as const,
  serviceId: args.serviceId,
  command: args.command,
  cwd: args.cwd,
  ...(args.port === undefined ? {} : { port: args.port }),
  ...(args.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: args.readyTimeoutMs }),
})

export const eventFrame = (frame: { kind: string }, type: string, serviceId: string): boolean =>
  frame.kind === 'event' &&
  (frame as { kind: string; event?: { type: string; serviceId?: string } }).event?.type === type &&
  (frame as { kind: string; event?: { serviceId?: string } }).event?.serviceId === serviceId

export const untilEvent = (args: {
  session: DaemonSession
  type: string
  serviceId: string
  timeoutMs?: number | undefined
}) =>
  args.session.until((frame) => eventFrame(frame, args.type, args.serviceId), {
    label: `${args.type} ${args.serviceId}`,
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
  })

export const httpListener = (port: number): string =>
  `bun -e "Bun.serve({ port: ${port}, fetch: () => new Response('ok') }); console.log('serving')" 2>&1`

export const startAndReady = async (args: {
  handle: DaemonHandle
  serviceId: string
  port?: number | undefined
  timeoutMs?: number | undefined
}): Promise<{ session: DaemonSession; info: ServiceInfo }> => {
  const session = await connectAt({ handle: args.handle })
  const port = args.port ?? (args.handle.realProcesses ? await freePort() : 9999)
  const result = await runToEnd({
    session,
    key: `s-start-${args.serviceId}`,
    op: startOp({
      serviceId: args.serviceId,
      command: args.handle.realProcesses ? httpListener(port) : `echo serving; listen ${port}`,
      cwd: '/',
      port,
    }),
    timeoutMs: args.timeoutMs ?? 15_000,
  })
  const info = okValue({ result, op: 'services.start' })
  expect(info.status).toBe(EServiceRunStatus.Ready)
  await untilEvent({ session, type: 'services.ready', serviceId: args.serviceId })
  return { session, info }
}
