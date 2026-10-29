import { systemNotice } from '../../context/envelope'
import type { EventOfType } from '../../events/envelope'

export const sandboxSetupBlock = (event: EventOfType<'sandbox-setup-reported'>): string =>
  systemNotice({ kind: 'sandbox-setup', content: event.text })
