import { z } from 'zod'

export const V2_RECONCILE_HOLDERS_TASK_ID = 'v2-reconcile-holders'
export const V2_RECONCILE_HOLDERS_CRON = '* * * * *'
export const V2_RECONCILE_LIMIT = 500

export const v2ReconcileHoldersPayloadSchema = z.strictObject({})

export type V2ReconcileHoldersPayload = z.infer<typeof v2ReconcileHoldersPayloadSchema>
