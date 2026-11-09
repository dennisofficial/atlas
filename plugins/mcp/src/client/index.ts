import type { ClientSlot } from '@dltech/atlas-plugin-sdk'

export const mcpClient: ClientSlot = {
  hooks: [
    {
      name: 'mcp-roster',
      appliesTo: (event) => event.type.startsWith('mcp-server-'),
    },
  ],
}
