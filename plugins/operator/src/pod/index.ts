import type { PodSlot } from '@dltech/atlas-plugin-sdk'

import { OperatorInputFragment } from './fragment'
import { OperatorInputTool } from './input-tool'
import { OperatorShellInputTool } from './shell-input-tool'

export { OperatorInputFragment } from './fragment'
export { OperatorInputTool } from './input-tool'
export { OperatorShellInputTool } from './shell-input-tool'

export const OPERATOR_TOOLS = ['operator_input', 'operator_shell_input'] as const

export const operatorPod: PodSlot = {
  tools: (ctx) => [new OperatorInputTool(ctx), new OperatorShellInputTool(ctx)],
  prompts: [new OperatorInputFragment()],
  commands: new Map(),
  childDeny: OPERATOR_TOOLS,
}
