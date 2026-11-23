import { ENotifyTrackEvent } from '@dltech/atlas-core'
import type { ProductAnalytics } from '@dltech/atlas-observability'
import {
  listNotifyDevicesOutputSchema,
  reportNotifyPresenceInputSchema,
  notifyWebPushKeyOutputSchema,
  registerNotifyDeviceInputSchema,
  registerNotifyDeviceOutputSchema,
  sendTestNotificationOutputSchema,
  setNotifyDeviceEnabledInputSchema,
  trackNotificationInputSchema,
  unregisterNotifyDeviceInputSchema,
  type ListNotifyDevicesOutput,
  type NotifyWebPushKeyOutput,
  type RegisterNotifyDeviceInput,
  type RegisterNotifyDeviceOutput,
  type ReportNotifyPresenceInput,
  type SendTestNotificationOutput,
  type SetNotifyDeviceEnabledInput,
  type TrackNotificationInput,
  type UnregisterNotifyDeviceInput,
} from '@dltech/atlas-wire'
import { TRPCError } from '@trpc/server'
import { Ctx, Input, Mutation, Query, Router, UseMiddlewares } from 'nestjs-trpc'
import { Inject, Optional } from '@nestjs/common'
import { z } from 'zod'
import { PRODUCT_ANALYTICS } from '../../../agent'
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

const CLIENT_EVENT_OF: Record<ENotifyTrackEvent, string> = {
  [ENotifyTrackEvent.Delivered]: 'notification_delivered',
  [ENotifyTrackEvent.Opened]: 'notification_opened',
  [ENotifyTrackEvent.Dismissed]: 'notification_dismissed',
  [ENotifyTrackEvent.InAppShown]: 'notification_in_app',
}

const notificationEventOf = (event: ENotifyTrackEvent): string => CLIENT_EVENT_OF[event]

@Router({ alias: 'notifications' })
@UseMiddlewares(SessionMiddleware)
export class NotificationsRouter {
  constructor(
    private readonly presence: PresenceRegistry,
    private readonly devices: NotifyDevicesService,
    private readonly dispatcher: JobsProjectDispatcher,
    private readonly env: EnvService,
    @Optional()
    @Inject(PRODUCT_ANALYTICS)
    private readonly analytics: ProductAnalytics | null = null,
  ) {}

  private captureTrack(args: { userId: string; input: TrackNotificationInput }): void {
    if (this.analytics === null) return
    try {
      const sentAtMs = args.input.sentAt === undefined ? null : Date.parse(args.input.sentAt)
      this.analytics.capture({
        userId: args.userId,
        event: notificationEventOf(args.input.event),
        properties: {
          moment: args.input.moment,
          device_kind: args.input.deviceKind,
          session_id: args.input.sessionId,
          seq: args.input.seq,
          ...(sentAtMs === null || Number.isNaN(sentAtMs)
            ? {}
            : { after_send_ms: Date.now() - sentAtMs }),
          ...(args.input.event === ENotifyTrackEvent.InAppShown ? { source: 'client' } : {}),
        },
      })
    } catch {
      // Metrics must never fail a tap or a notification.
    }
  }

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

  @Mutation({ input: trackNotificationInputSchema, output: z.void() })
  async track(@Input() input: TrackNotificationInput, @Ctx() ctx: SessionTrpcCtx): Promise<void> {
    this.refuseBatched(ctx)
    this.captureTrack({ userId: ctx.auth.userId, input })
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
