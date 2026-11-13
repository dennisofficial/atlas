import type { PodSlot } from '@dltech/atlas-plugin-sdk'

import { OPERATOR_SHELL_INPUT_TOOL, OPERATOR_INPUT_TOOL } from '../core/request'
import { OperatorInputFragment } from './fragment'
import { OperatorInputTool } from './input-tool'
import { OperatorShellInputTool } from './shell-input-tool'

export { OperatorInputFragment } from './fragment'
export { OperatorInputTool } from './input-tool'
export { OperatorShellInputTool } from './shell-input-tool'

export const OPERATOR_TOOLS = [OPERATOR_INPUT_TOOL, OPERATOR_SHELL_INPUT_TOOL] as const

export const operatorPod: PodSlot = {
  tools: () => [new OperatorInputTool(), new OperatorShellInputTool()],
  prompts: [new OperatorInputFragment()],
  commands: new Map(),
  childDeny: OPERATOR_TOOLS,
}
