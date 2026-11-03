import { z } from 'zod'

export const RECONCILE_HOLDERS_TASK_ID = 'reconcile-holders'
export const RECONCILE_HOLDERS_CRON = '* * * * *'
export const RECONCILE_LIMIT = 500

export const reconcileHoldersPayloadSchema = z.strictObject({})

export type ReconcileHoldersPayload = z.infer<typeof reconcileHoldersPayloadSchema>
