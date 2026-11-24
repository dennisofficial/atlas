import { systemNotice } from '../../context/envelope'
import { podResizedLine } from '../../pod/pod-resize-notice'
import type { EventOfType } from '../../events/envelope'

export const podResizedBlock = (event: EventOfType<'pod-resized'>): string =>
  systemNotice({ kind: 'pod-resized', content: podResizedLine(event) })
