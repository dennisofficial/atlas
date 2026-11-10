import { z } from 'zod'

export enum EDesktopUpdateState {
  Idle = 'idle',
  Ready = 'ready',
  Restarting = 'restarting',
}

export enum EWebPayloadState {
  Idle = 'idle',
  Ready = 'ready',
}

export const webPayloadStatusSchema = z.object({
  state: z.enum(EWebPayloadState),
  version: z.string().min(1).optional(),
  hash: z.string().min(1).optional(),
  builtAt: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
})
export type WebPayloadStatus = z.infer<typeof webPayloadStatusSchema>

export const desktopUpdateSchema = z.object({
  state: z.enum(EDesktopUpdateState),
  version: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
  web: webPayloadStatusSchema.optional(),
})
export type DesktopUpdate = z.infer<typeof desktopUpdateSchema>

export async function getDesktopUpdate(): Promise<DesktopUpdate> {
  const response = await fetch('/desktop/update')
  if (!response.ok) throw new Error(`Update status failed: ${response.status}`)
  return desktopUpdateSchema.parse(await response.json())
}

export async function checkForUpdate(): Promise<DesktopUpdate> {
  const response = await fetch('/desktop/update/check', { method: 'POST' })
  if (!response.ok) throw new Error(`Update check failed: ${response.status}`)
  return desktopUpdateSchema.parse(await response.json())
}

export async function restartForUpdate(): Promise<void> {
  const response = await fetch('/desktop/update/restart', { method: 'POST' })
  if (!response.ok) throw new Error(`Restart failed: ${response.status}`)
}
