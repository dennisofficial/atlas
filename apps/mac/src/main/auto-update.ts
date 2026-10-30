import { writeLog } from './crash-log'

export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface IUpdaterPort {
  checkForUpdate: () => Promise<{ updateAvailable: boolean; error: string }>
  downloadUpdate: () => Promise<void>
  updateInfo: () => { updateReady: boolean; version: string }
}

export type TOnReady = (args: { version: string }) => void

export async function checkAndDownload({ updater }: { updater: IUpdaterPort }): Promise<boolean> {
  const result = await updater.checkForUpdate()
  if (result.error.length > 0) throw new Error(result.error)
  if (!result.updateAvailable) return false
  await updater.downloadUpdate()
  return updater.updateInfo().updateReady
}

export async function runUpdateCycle({
  updater,
  onReady,
}: {
  updater: IUpdaterPort
  onReady: TOnReady
}): Promise<void> {
  try {
    if (!(await checkAndDownload({ updater }))) return
    onReady({ version: updater.updateInfo().version })
  } catch (error) {
    writeLog({ label: 'auto-update', error })
  }
}

export function startAutoUpdate({
  updater,
  onReady,
}: {
  updater: IUpdaterPort
  onReady: TOnReady
}): void {
  const cycle = () => runUpdateCycle({ updater, onReady })
  void cycle()
  setInterval(() => void cycle(), UPDATE_INTERVAL_MS)
}
