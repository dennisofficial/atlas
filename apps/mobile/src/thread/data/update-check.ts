export enum EUpdateStage {
  Idle = 'idle',
  Checking = 'checking',
  Ready = 'ready',
  NoUpdate = 'no-update',
  Failed = 'failed',
}

export type UpdatesClient = {
  check: () => Promise<{ isAvailable: boolean }>
  fetch: () => Promise<unknown>
  reload: () => Promise<void>
}

export type UpdateCardView = {
  detail: string | null
  actionLabel: string
}

export const STALE_TITLE = 'A newer Atlas wrote this session.'

export const checkForUpdate = async (args: { client: UpdatesClient }): Promise<EUpdateStage> => {
  try {
    const update = await args.client.check()
    if (!update.isAvailable) return EUpdateStage.NoUpdate
    await args.client.fetch()
    return EUpdateStage.Ready
  } catch {
    return EUpdateStage.Failed
  }
}

export const restartApp = async (args: { client: UpdatesClient }): Promise<EUpdateStage> => {
  try {
    await args.client.reload()
    return EUpdateStage.Ready
  } catch {
    return EUpdateStage.Failed
  }
}

export const updateCardView = (stage: EUpdateStage): UpdateCardView => {
  switch (stage) {
    case EUpdateStage.Ready:
      return { detail: 'Update ready — restart to finish', actionLabel: 'Restart' }
    case EUpdateStage.NoUpdate:
      return {
        detail: 'No update has been released yet. Try again in a few minutes.',
        actionLabel: 'Check for updates',
      }
    case EUpdateStage.Failed:
      return { detail: 'The update check failed.', actionLabel: 'Check for updates' }
    default:
      return { detail: null, actionLabel: 'Check for updates' }
  }
}
