import { BrowserView } from 'electrobun/main'

import { childViewIdsOf } from './preview-views'

export function clearChildViews(hostId: number | undefined): number {
  const ids = childViewIdsOf({ views: BrowserView.getAll(), hostId })
  for (const id of ids) BrowserView.getById(id)?.remove()
  return ids.length
}
