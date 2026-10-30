import { isDragRegionTarget } from './drag-target'

export const TITLEBAR_DOUBLE_CLICK_PATH = '/desktop/window/titlebar-double-click'

export function handleDocumentDoubleClick({
  event,
  post,
}: {
  event: Pick<MouseEvent, 'target'>
  post: (path: string) => void
}): void {
  if (isDragRegionTarget(event.target)) post(TITLEBAR_DOUBLE_CLICK_PATH)
}

export function postTitlebarDoubleClick(path: string): void {
  void fetch(path, { method: 'POST' }).catch(() => undefined)
}
