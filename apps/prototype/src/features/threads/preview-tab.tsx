import { useState } from 'react'

import { PreviewFrame } from '@dltech/atlas-ui/ai/preview-frame'

import { PREVIEW_URLS } from './session-previews'

export interface PreviewTabProps {
  initialPreviewId?: string
}

export function PreviewTab({ initialPreviewId = PREVIEW_URLS[0]?.id }: PreviewTabProps) {
  const [selectedId, setSelectedId] = useState(initialPreviewId)

  return <PreviewFrame ports={PREVIEW_URLS} selectedId={selectedId} onSelect={setSelectedId} />
}
