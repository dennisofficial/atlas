import { z } from 'zod'

export enum EDesktopUpdateState {
  Idle = 'idle',
  Ready = 'ready',
  Restarting = 'restarting',
}

export const desktopUpdateSchema = z.object({
  state: z.enum(EDesktopUpdateState),
  version: z.string().min(1).optional(),
  error: z.string().min(1).optional(),
})
export type DesktopUpdate = z.infer<typeof desktopUpdateSchema>

export async function getDesktopUpdate(): Promise<DesktopUpdate> {
  const response = await fetch('/desktop/update')
  if (!response.ok) throw new Error(`Update status failed: ${response.status}`)
  return desktopUpdateSchema.parse(await response.json())
}

export async function restartForUpdate(): Promise<void> {
  const response = await fetch('/desktop/update/restart', { method: 'POST' })
  if (!response.ok) throw new Error(`Restart failed: ${response.status}`)
}
