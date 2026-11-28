export type PreviewDocumentReport = {
  sessionId: string
  tabId: string
  url: string
  startingPage: boolean | undefined
  loaded: boolean | undefined
}

const listeners = new Set<(report: PreviewDocumentReport) => void>()

export function reportPreviewDocument(report: PreviewDocumentReport): void {
  for (const listener of listeners) listener(report)
}

export function subscribePreviewDocuments(listener: (report: PreviewDocumentReport) => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
