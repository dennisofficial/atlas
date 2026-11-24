import { defineCommand, EClientAction, ECommandGroup, ECommandRunsIn } from '@dltech/atlas-commands'
import { z } from 'zod'

export const mcp = defineCommand({
  spec: {
    name: 'mcp',
    summary: "the session's MCP servers, and sign in to one",
    group: ECommandGroup.Workspace,
    args: z.strictObject({}),
    runsIn: ECommandRunsIn.Client,
    opens: EClientAction.Mcp,
  },
})
