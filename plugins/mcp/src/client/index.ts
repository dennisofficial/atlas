import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

import { mcpSignInEntries } from './sign-in-entry'

export { mcpSignInEntries }

export const mcpClient: ClientSlot = {
  hooks: [
    {
      name: 'mcp-roster',
      appliesTo: (event) => event.type.startsWith('mcp-server-'),
    },
  ],
  entryFolds: [mcpSignInEntries],
}
