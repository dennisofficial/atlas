import { systemNotice } from '../../context/envelope'
import type { EventOfType } from '../../events/envelope'

export const nudgeBlock = (event: EventOfType<'nudge'>): string =>
  systemNotice({ kind: 'nudge', content: event.text })
