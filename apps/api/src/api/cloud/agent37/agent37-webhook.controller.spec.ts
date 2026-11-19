import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'bun:test'
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnsupportedMediaTypeException,
} from '@nestjs/common'
import { ESandboxStatus } from '@dltech/atlas-protocol'
import { EnvService } from '../../../_core/config/env/env.service'
import { Agent37WebhookController } from './agent37-webhook.controller'
import type { Agent37WebhookService } from './agent37-webhook.service'

const SECRET = `whsec_${Buffer.from('agent37-test-signing-key').toString('base64')}`
const INSTANCE = 'ab12cd34ef'
const AT = '2026-11-19T12:00:00.123Z'

function controllerWith(
  env: Record<string, string | undefined> = { AGENT37_WEBHOOK_SECRET: SECRET },
) {
  const applied: Array<{ instanceId: string; status: ESandboxStatus; at: string }> = []
  const statuses = {
    applyStatus: async (args: { instanceId: string; status: ESandboxStatus; at: string }) => {
      applied.push(args)
      return args.instanceId === INSTANCE
    },
  } as unknown as Agent37WebhookService
  return {
    controller: new Agent37WebhookController(new EnvService(env), statuses),
    applied,
  }
}

type StatusEventBody = {
  type: string
  timestamp: string
  data: { id: string; status: string; previous_status?: string | undefined }
}

function eventOf(patch: { type?: string; status?: string } = {}): StatusEventBody {
  return {
    type: patch.type ?? 'instance.status.updated',
    timestamp: AT,
    data: { id: INSTANCE, status: patch.status ?? 'running', previous_status: 'starting' },
  }
}

function deliver(args: {
  controller: Agent37WebhookController
  body?: unknown
  rawBody?: Buffer | undefined
  signature?: string
  timestamp?: string
  contentType?: string | undefined
}) {
  const rawBody = args.rawBody ?? Buffer.from(JSON.stringify(args.body ?? eventOf()))
  const timestamp = args.timestamp ?? String(Math.floor(Date.now() / 1000))
  const request = 'rawBody' in args && args.rawBody === undefined ? {} : { rawBody }
  const signature =
    args.signature ??
    `v1,${createHmac('sha256', Buffer.from(SECRET.replace(/^whsec_/, ''), 'base64'))
      .update(`evt_1.${timestamp}.`)
      .update(rawBody)
      .digest('base64')}`
  return args.controller.handleDelivery(
    request,
    'evt_1',
    timestamp,
    signature,
    'contentType' in args ? args.contentType : 'application/json',
  )
}

describe('Agent37WebhookController', () => {
  it('applies a verified status event to the instance', async () => {
    const { controller, applied } = controllerWith()

    expect(await deliver({ controller })).toEqual({ received: true })
    expect(applied).toEqual([{ instanceId: INSTANCE, status: ESandboxStatus.Running, at: AT }])
  })

  it('answers 2xx and ignores an instance no session owns', async () => {
    const { controller } = controllerWith()

    const body = { ...eventOf(), data: { id: 'unknown', status: 'running' } }

    expect(await deliver({ controller, body })).toEqual({ received: true })
  })

  it('refuses a delivery when the secret is not configured', async () => {
    const { controller } = controllerWith({})

    await expect(deliver({ controller })).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('refuses a bad signature', async () => {
    const { controller } = controllerWith()

    await expect(deliver({ controller, signature: 'v1,AAAA' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('refuses a delivery without a body', async () => {
    const { controller } = controllerWith()

    await expect(deliver({ controller, rawBody: undefined })).rejects.toBeInstanceOf(
      UnauthorizedException,
    )
  })

  it('refuses a delivery that is not json', async () => {
    const { controller } = controllerWith()

    await expect(deliver({ controller, rawBody: Buffer.from('not json') })).rejects.toBeInstanceOf(
      BadRequestException,
    )
  })

  it('refuses a delivery that is not declared as json', async () => {
    const { controller } = controllerWith()

    await expect(deliver({ controller, contentType: 'text/plain' })).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    )
  })

  it('ignores another event type without touching a session', async () => {
    const { controller, applied } = controllerWith()

    expect(await deliver({ controller, body: eventOf({ type: 'instance.created' }) })).toEqual({
      received: true,
    })
    expect(applied).toEqual([])
  })

  it('ignores a status the protocol does not know', async () => {
    const { controller, applied } = controllerWith()

    expect(await deliver({ controller, body: eventOf({ status: 'hibernating' }) })).toEqual({
      received: true,
    })
    expect(applied).toEqual([])
  })
})
