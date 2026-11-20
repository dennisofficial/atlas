import { resetPreviewBrowsers } from '../../../data/preview-browser/use-preview-browser'
import { resetFrameRegistry } from '../frame-registry'

export const resetPreviewState = (): void => {
  resetFrameRegistry()
  resetPreviewBrowsers()
}
