import { writeLog } from './crash-log'

export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface IUpdaterPort {
  checkForUpdate: () => Promise<{ updateAvailable: boolean; error: string }>
  downloadUpdate: () => Promise<void>
  updateInfo: () => { updateReady: boolean }
}

export type TPrompt = () => Promise<boolean>

export async function checkAndDownload({ updater }: { updater: IUpdaterPort }): Promise<boolean> {
  const result = await updater.checkForUpdate()
  if (result.error.length > 0) throw new Error(result.error)
  if (!result.updateAvailable) return false
  await updater.downloadUpdate()
  return updater.updateInfo().updateReady
}

export async function runUpdateCycle({
  updater,
  prompt,
  apply,
}: {
  updater: IUpdaterPort
  prompt: TPrompt
  apply: () => Promise<void>
}): Promise<void> {
  try {
    if (!(await checkAndDownload({ updater }))) return
    if (await prompt()) await apply()
  } catch (error) {
    writeLog({ label: 'auto-update', error })
  }
}

export function startAutoUpdate({
  updater,
  prompt,
  apply,
}: {
  updater: IUpdaterPort
  prompt: TPrompt
  apply: () => Promise<void>
}): void {
  const cycle = () => runUpdateCycle({ updater, prompt, apply })
  void cycle()
  setInterval(() => void cycle(), UPDATE_INTERVAL_MS)
}
