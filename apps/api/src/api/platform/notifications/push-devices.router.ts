import {
  registerPushDeviceInputSchema,
  registerPushDeviceReplySchema,
  sendTestPushInputSchema,
  sendTestPushReplySchema,
  unregisterPushDeviceInputSchema,
  type RegisterPushDeviceInput,
  type RegisterPushDeviceReply,
  type SendTestPushInput,
  type SendTestPushReply,
  type UnregisterPushDeviceInput,
} from '@dltech/atlas-wire'
import { db } from '@dltech/atlas-db'
import { Ctx, Input, Mutation, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { NotificationsService } from './notifications.service'

const TEST_PUSH_TITLE = 'Atlas'
const TEST_PUSH_BODY = 'Test notification'

@Router({ alias: 'pushDevices' })
@UseMiddlewares(SessionMiddleware)
export class PushDevicesRouter {
  constructor(private readonly notifications: NotificationsService) {}

  @Mutation({ input: registerPushDeviceInputSchema, output: registerPushDeviceReplySchema })
  async register(
    @Input() input: RegisterPushDeviceInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<RegisterPushDeviceReply> {
    const existing = await db.orm.public.PushDevice.where({ token: input.token }).first()
    if (existing === null) {
      const device = await db.orm.public.PushDevice.create({
        token: input.token,
        platform: input.platform,
        lastSeenAt: new Date(),
        userId: ctx.auth.userId,
      })
      return { id: device.id }
    }
    const device = await db.orm.public.PushDevice.where({ token: input.token }).update({
      userId: ctx.auth.userId,
      platform: input.platform,
      lastSeenAt: new Date(),
    })
    if (device === null) throw new Error('push device vanished during registration')
    return { id: device.id }
  }

  @Mutation({ input: unregisterPushDeviceInputSchema, output: z.void() })
  async unregister(
    @Input() input: UnregisterPushDeviceInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    await db.orm.public.PushDevice.where({ token: input.token, userId: ctx.auth.userId }).delete()
  }

  @Mutation({ input: sendTestPushInputSchema, output: sendTestPushReplySchema })
  async sendTest(
    @Input() _input: SendTestPushInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<SendTestPushReply> {
    const devices = await db.orm.public.PushDevice.where({ userId: ctx.auth.userId }).all()
    await this.notifications.notifyUser({
      userId: ctx.auth.userId,
      title: TEST_PUSH_TITLE,
      body: TEST_PUSH_BODY,
      idempotencyKey: `test-push:${ctx.auth.userId}:${new Date().toISOString()}`,
    })
    return { devices: devices.length }
  }
}
