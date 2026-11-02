import { Updater, Utils } from 'electrobun/main'
import { checkNow, EManualCheckOutcome, restartToPrepared } from './auto-update'
import type { IUpdateState } from './update-state'

const RESTART_BUTTON = 0

export async function runCheckForUpdates({ state }: { state: IUpdateState }): Promise<void> {
  const result = await checkNow({ updater: Updater, onReady: state.markReady })
  if (result.outcome === EManualCheckOutcome.Current) {
    await Utils.showMessageBox({
      type: 'info',
      title: 'Check for Updates',
      message: 'Atlas is up to date.',
      buttons: ['OK'],
    })
    return
  }
  if (result.outcome === EManualCheckOutcome.Failed) {
    await Utils.showMessageBox({
      type: 'warning',
      title: 'Check for Updates',
      message: 'Atlas could not check for updates.',
      detail: result.message,
      buttons: ['OK'],
    })
    return
  }
  const { response } = await Utils.showMessageBox({
    type: 'question',
    title: 'Update Ready',
    message:
      result.version.length > 0 ? `Atlas ${result.version} is ready.` : 'An update is ready.',
    detail: 'Restart Atlas to install it.',
    buttons: ['Restart Now', 'Later'],
    defaultId: RESTART_BUTTON,
    cancelId: 1,
  })
  if (response === RESTART_BUTTON) await restartToPrepared({ updater: Updater, state })
}
