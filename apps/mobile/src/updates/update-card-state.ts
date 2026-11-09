export enum EUpdateCardKind {
  Downloading = 'downloading',
  Downloadable = 'downloadable',
  Ready = 'ready',
}

export enum EUpdateCardAction {
  Download = 'download',
  Restart = 'restart',
}

export type UpdateCardModel = {
  kind: EUpdateCardKind
  title: string
  detail: string
  action: EUpdateCardAction | null
  actionLabel: string | null
  dismissible: boolean
}

const READY: UpdateCardModel = {
  kind: EUpdateCardKind.Ready,
  title: 'Update ready',
  detail: 'Restart Atlas to use the newest version.',
  action: EUpdateCardAction.Restart,
  actionLabel: 'Restart',
  dismissible: true,
}

const DOWNLOADING: UpdateCardModel = {
  kind: EUpdateCardKind.Downloading,
  title: 'Downloading update…',
  detail: 'The newest version will be ready in a moment.',
  action: null,
  actionLabel: null,
  dismissible: false,
}

const DOWNLOADABLE: UpdateCardModel = {
  kind: EUpdateCardKind.Downloadable,
  title: 'Update available',
  detail: 'Download the newest version of Atlas.',
  action: EUpdateCardAction.Download,
  actionLabel: 'Download',
  dismissible: true,
}

export const updateCardOf = (args: {
  enabled: boolean
  dismissed: boolean
  isUpdateAvailable: boolean
  isUpdatePending: boolean
  isDownloading: boolean
}): UpdateCardModel | null => {
  if (!args.enabled || args.dismissed) return null
  if (args.isUpdatePending) return READY
  if (args.isDownloading) return DOWNLOADING
  if (args.isUpdateAvailable) return DOWNLOADABLE
  return null
}
