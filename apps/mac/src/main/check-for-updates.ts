import { Updater, Utils } from 'electrobun/main'
import { EWebPayloadState, type IWebPayloadStatus } from '../host/web-payload/updater'
import { checkNow, EManualCheckOutcome, restartToPrepared } from './auto-update'
import type { IUpdateState } from './update-state'

const PRIMARY_BUTTON = 0

export interface IWebUpdateManual {
  check: () => Promise<IWebPayloadStatus>
  apply: () => Promise<boolean>
}

export async function runCheckForUpdates({
  state,
  web,
}: {
  state: IUpdateState
  web?: IWebUpdateManual | undefined
}): Promise<void> {
  const webStatus = web === undefined ? undefined : await web.check()
  const result = await checkNow({ updater: Updater, onReady: state.markReady })

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

  if (result.outcome === EManualCheckOutcome.Ready) {
    const { response } = await Utils.showMessageBox({
      type: 'question',
      title: 'Update Ready',
      message:
        result.version.length > 0 ? `App ${result.version} is ready.` : 'An update is ready.',
      detail: 'Restart Atlas to install it.',
      buttons: ['Restart Now', 'Later'],
      defaultId: PRIMARY_BUTTON,
      cancelId: 1,
    })
    if (response === PRIMARY_BUTTON) await restartToPrepared({ updater: Updater, state })
    return
  }

  if (web !== undefined && webStatus?.state === EWebPayloadState.Ready) {
    const applied = await web.apply()
    await Utils.showMessageBox({
      type: applied ? 'info' : 'warning',
      title: 'Check for Updates',
      message: applied
        ? 'Atlas is running the latest interface.'
        : 'The new interface did not start.',
      detail: applied
        ? 'The window reloaded. No app restart was needed.'
        : 'Atlas kept the previous interface and will try again on the next check.',
      buttons: ['OK'],
    })
    return
  }

  if (webStatus?.error !== undefined) {
    await Utils.showMessageBox({
      type: 'warning',
      title: 'Check for Updates',
      message: 'Atlas could not update its interface.',
      detail: webStatus.error,
      buttons: ['OK'],
    })
    return
  }

  await Utils.showMessageBox({
    type: 'info',
    title: 'Check for Updates',
    message: 'Atlas is up to date.',
    buttons: ['OK'],
  })
}
