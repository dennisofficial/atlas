import { writeLog } from './crash-log'

export const UPDATE_INTERVAL_MS = 5 * 60 * 1000

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

export enum EManualCheckOutcome {
  Ready = 'ready',
  Current = 'current',
  Failed = 'failed',
}

export type TManualCheckResult =
  | { outcome: EManualCheckOutcome.Ready; version: string }
  | { outcome: EManualCheckOutcome.Current }
  | { outcome: EManualCheckOutcome.Failed; message: string }

export async function checkNow({
  updater,
  onReady,
}: {
  updater: IUpdaterPort
  onReady: TOnReady
}): Promise<TManualCheckResult> {
  try {
    if (!(await checkAndDownload({ updater }))) return { outcome: EManualCheckOutcome.Current }
    const { version } = updater.updateInfo()
    onReady({ version })
    return { outcome: EManualCheckOutcome.Ready, version }
  } catch (error) {
    writeLog({ label: 'auto-update', error })
    const message = error instanceof Error ? error.message : String(error)
    return { outcome: EManualCheckOutcome.Failed, message }
  }
}
