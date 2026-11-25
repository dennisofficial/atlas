import { randomUUID } from 'node:crypto'

import { Injectable } from '@nestjs/common'
import { db } from '@dltech/atlas-db'
import { notifyDeviceKindSchema } from '@dltech/atlas-wire'
import type {
  NotifyDeviceView,
  RegisterNotifyDeviceInput,
  SetNotifyDeviceEnabledInput,
  UnregisterNotifyDeviceInput,
} from '@dltech/atlas-wire'

@Injectable()
export class NotifyDevicesService {
  async register(args: {
    userId: string
    input: RegisterNotifyDeviceInput
  }): Promise<{ id: string }> {
    const { input, userId } = args
    const now = new Date()
    const existing = await db.orm.public.PushDevice.where({ token: input.token }).first()
    if (existing === null) {
      const created = await db.orm.public.PushDevice.create({
        id: randomUUID(),
        userId,
        kind: input.kind,
        token: input.token,
        secret: input.secret,
        clientId: input.clientId,
        label: input.label,
        lastSeenAt: now,
        createdAt: now,
      })
      return { id: created.id }
    }
    const updated = await db.orm.public.PushDevice.where({ id: existing.id }).update({
      userId,
      kind: input.kind,
      secret: input.secret,
      clientId: input.clientId,
      label: input.label,
      lastSeenAt: now,
      disabledAt: null,
    })
    if (updated === null) throw new Error('the push device vanished during registration')
    return { id: updated.id }
  }

  async unregister(args: { userId: string; input: UnregisterNotifyDeviceInput }): Promise<void> {
    await db.orm.public.PushDevice.where({
      id: args.input.deviceId,
      userId: args.userId,
    }).delete()
  }

  async list(args: { userId: string }): Promise<NotifyDeviceView[]> {
    const rows = await db.orm.public.PushDevice.where({ userId: args.userId }).all()
    return rows.map((row) => ({
      id: row.id,
      kind: notifyDeviceKindSchema.parse(row.kind),
      label: row.label,
      enabled: row.disabledAt === null,
      lastSeenAt: row.lastSeenAt.toISOString(),
    }))
  }

  async setEnabled(args: { userId: string; input: SetNotifyDeviceEnabledInput }): Promise<void> {
    const disabledAt = args.input.enabled ? null : new Date()
    await db.orm.public.PushDevice.where({
      id: args.input.deviceId,
      userId: args.userId,
    }).update({ disabledAt })
  }

  async enabledCount(args: { userId: string }): Promise<number> {
    const rows = await db.orm.public.PushDevice.where({ userId: args.userId }).all()
    return rows.filter((row) => row.disabledAt === null).length
  }
}
