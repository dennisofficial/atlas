import {
  listNotifyDevicesOutputSchema,
  reportNotifyPresenceInputSchema,
  notifyWebPushKeyOutputSchema,
  registerNotifyDeviceInputSchema,
  registerNotifyDeviceOutputSchema,
  sendTestNotificationOutputSchema,
  setNotifyDeviceEnabledInputSchema,
  unregisterNotifyDeviceInputSchema,
  type ListNotifyDevicesOutput,
  type NotifyWebPushKeyOutput,
  type RegisterNotifyDeviceInput,
  type RegisterNotifyDeviceOutput,
  type ReportNotifyPresenceInput,
  type SendTestNotificationOutput,
  type SetNotifyDeviceEnabledInput,
  type UnregisterNotifyDeviceInput,
} from '@dltech/atlas-wire'
import { TRPCError } from '@trpc/server'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { z } from 'zod'
import { EnvService } from '../../../_core/config/env/env.service'
import { JobsProjectDispatcher } from '../../../_core/ports/job-dispatcher'
import { SessionMiddleware, type SessionTrpcCtx } from '../../../_module/session/session.middleware'
import { NotifyDevicesService } from './notify-devices.service'
import {
  notifyTestIdempotencyKey,
  notifyTestTaskContract,
} from '../../../_lib/trigger/notify-send.contract'
import { PresenceRegistry } from './presence-registry'

const NO_INPUT = z.strictObject({})

@Router({ alias: 'notifications' })
@UseMiddlewares(SessionMiddleware)
export class NotificationsRouter {
  constructor(
    private readonly presence: PresenceRegistry,
    private readonly devices: NotifyDevicesService,
    private readonly dispatcher: JobsProjectDispatcher,
    private readonly env: EnvService,
  ) {}

  private refuseBatched(ctx: SessionTrpcCtx): void {
    if (ctx.req.query.batch === '1') {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'batched calls are not supported' })
    }
  }

  @Mutation({ input: reportNotifyPresenceInputSchema, output: z.void() })
  async reportPresence(
    @Input() input: ReportNotifyPresenceInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    this.refuseBatched(ctx)
    await this.presence.report({ userId: ctx.auth.userId, ...input })
  }

  @Query({ input: NO_INPUT, output: notifyWebPushKeyOutputSchema })
  webPushKey(): NotifyWebPushKeyOutput {
    const publicKey = this.env.get('WEB_PUSH_PUBLIC_KEY')
    return { publicKey: publicKey === undefined || publicKey === '' ? null : publicKey }
  }

  @Mutation({ input: registerNotifyDeviceInputSchema, output: registerNotifyDeviceOutputSchema })
  registerDevice(
    @Input() input: RegisterNotifyDeviceInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<RegisterNotifyDeviceOutput> {
    this.refuseBatched(ctx)
    return this.devices.register({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: unregisterNotifyDeviceInputSchema, output: z.void() })
  async unregisterDevice(
    @Input() input: UnregisterNotifyDeviceInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    this.refuseBatched(ctx)
    await this.devices.unregister({ userId: ctx.auth.userId, input })
  }

  @Query({ input: NO_INPUT, output: listNotifyDevicesOutputSchema })
  async listDevices(@Ctx() ctx: SessionTrpcCtx): Promise<ListNotifyDevicesOutput> {
    return { devices: await this.devices.list({ userId: ctx.auth.userId }) }
  }

  @Mutation({ input: setNotifyDeviceEnabledInputSchema, output: z.void() })
  async setDeviceEnabled(
    @Input() input: SetNotifyDeviceEnabledInput,
    @Ctx() ctx: SessionTrpcCtx,
  ): Promise<void> {
    this.refuseBatched(ctx)
    await this.devices.setEnabled({ userId: ctx.auth.userId, input })
  }

  @Mutation({ input: NO_INPUT, output: sendTestNotificationOutputSchema })
  async sendTest(@Ctx() ctx: SessionTrpcCtx): Promise<SendTestNotificationOutput> {
    this.refuseBatched(ctx)
    const devices = await this.devices.enabledCount({ userId: ctx.auth.userId })
    const payload = { userId: ctx.auth.userId }
    try {
      await this.dispatcher.dispatch({
        task: notifyTestTaskContract,
        payload,
        idempotencyKey: notifyTestIdempotencyKey({ payload, now: new Date().toISOString() }),
      })
    } catch (failure) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: `the test notification could not be queued: ${String(failure)}`,
      })
    }
    return { devices }
  }
}
