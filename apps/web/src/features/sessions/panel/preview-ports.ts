import type { PreviewItem } from '@dltech/atlas-plugin-services/client'
import { EPreviewStatus, type PreviewPort } from '@dltech/atlas-ui/ai/preview-browser'

export const previewPortOf = (item: PreviewItem): PreviewPort => ({
  id: `service:${item.serviceId}`,
  port: item.port,
  label: item.label,
  url: item.url,
  status: EPreviewStatus.Live,
})

export const previewPortsOf = (items: readonly PreviewItem[]): PreviewPort[] =>
  items.map(previewPortOf)
