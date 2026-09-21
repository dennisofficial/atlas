import { Logger } from '@nestjs/common'
import { db } from '../../../db'
import { ESandboxDriveMode } from '../../sandboxes/sandboxes.types'
import { SandboxesService } from '../../sandboxes/sandboxes.service'
import type { OrchestratorChannel } from './orchestrator-channel'

const logger = new Logger('FactoryServeDelivery')

type Endpoint = { token: string; url: string }

export type ServeDeliveryDeps = {
  sandboxes: SandboxesService
  channel: OrchestratorChannel
}

export type ServeAttachExtras = {
  drive?: { name: string; mode: ESandboxDriveMode } | undefined
  pinnedModel?: string | undefined
}

export async function serveMessageCommitted(args: {
  threadId: string
  marker: string
}): Promise<boolean> {
  const landed = await db.event.findFirst({
    where: { threadId: args.threadId, type: 'user-said', body: { contains: args.marker } },
    select: { id: true },
  })
  return landed !== null
}

async function inject(args: {
  deps: ServeDeliveryDeps
  endpoint: Endpoint
  threadId: string
  text: string
  marker: string
}): Promise<void> {
  if (await serveMessageCommitted({ threadId: args.threadId, marker: args.marker })) return
  await args.deps.channel.inject({
    url: args.endpoint.url,
    token: args.endpoint.token,
    threadId: args.threadId,
    text: args.text,
    accepted: () => serveMessageCommitted({ threadId: args.threadId, marker: args.marker }),
  })
}

/**
 * One fresh-socket retry before escalating: an attach rotates the token, and the launcher reads
 * the running serve's stale-token 401 as a wedge and restarts it — so anything that might be a
 * transient socket error gets a second chance on the credential the serve actually booted with.
 */
async function tryEndpoint(args: {
  deps: ServeDeliveryDeps
  endpoint: Endpoint
  threadId: string
  text: string
  marker: string
}): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await inject(args)
      return true
    } catch {
      if (await serveMessageCommitted({ threadId: args.threadId, marker: args.marker })) {
        return true
      }
    }
  }
  return false
}

/**
 * Inject into a thread whose sandbox is already provisioned and settled (spawn did the attach).
 * The running endpoint is resolved fresh — a settled sandbox answers runningEndpoint.
 */
export async function injectIntoServeThread(args: {
  deps: ServeDeliveryDeps
  userId: string
  threadId: string
  text: string
  marker: string
}): Promise<void> {
  const running = await args.deps.sandboxes.runningEndpoint({
    userId: args.userId,
    threadId: args.threadId,
  })
  if (running === null) {
    throw new Error(`thread ${args.threadId} has no running sandbox to inject into`)
  }
  const delivered = await tryEndpoint({
    deps: args.deps,
    endpoint: running,
    threadId: args.threadId,
    text: args.text,
    marker: args.marker,
  })
  if (!delivered) {
    throw new Error(`the running sandbox for thread ${args.threadId} refused the injection`)
  }
}

/**
 * The one way a factory message reaches a serve thread end to end: reuse the running endpoint
 * when there is one, re-attach (resume or re-provision the named sandbox) when there is not, and
 * count delivery only when the message is committed in the durable event log. A re-attach leaves
 * the row's stored workspace and drive untouched — claim rotation only writes what it is handed.
 */
export async function deliverToServeThread(args: {
  deps: ServeDeliveryDeps
  userId: string
  threadId: string
  sandboxName: string
  text: string
  marker: string
  extras?: ServeAttachExtras | undefined
}): Promise<void> {
  const running = await args.deps.sandboxes.runningEndpoint({
    userId: args.userId,
    threadId: args.threadId,
  })
  if (running !== null) {
    const delivered = await tryEndpoint({
      deps: args.deps,
      endpoint: running,
      threadId: args.threadId,
      text: args.text,
      marker: args.marker,
    })
    if (delivered) return
    logger.log(`cached endpoint for thread ${args.threadId} is dead, re-attaching`)
  }

  const attachment = await args.deps.sandboxes.attach({
    userId: args.userId,
    threadId: args.threadId,
    name: args.sandboxName,
    ...(args.extras?.drive === undefined ? {} : { drive: args.extras.drive }),
    ...(args.extras?.pinnedModel === undefined ? {} : { pinnedModel: args.extras.pinnedModel }),
  })
  await args.deps.sandboxes.whenSettled({ threadId: args.threadId })
  const status = await args.deps.sandboxes.status({ userId: args.userId, threadId: args.threadId })
  if (status.url === undefined) {
    throw new Error(`sandbox ${status.name} has no serve route`)
  }
  await inject({
    deps: args.deps,
    endpoint: { token: attachment.token, url: status.url },
    threadId: args.threadId,
    text: args.text,
    marker: args.marker,
  })
}
