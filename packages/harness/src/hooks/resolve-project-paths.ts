import { isAbsolute, resolve } from 'node:path'

import {
  BeforeToolHook,
  EBeforeToolDecision,
  EPathForm,
  EStage,
  ToolDefinition,
  type BeforeTool,
  type HookOrder,
  type ToolDeclaration,
} from '@dltech/atlas-core'

import {  portToken } from '../container/injection'
import {
  ABSENT,
  createDeclaredPaths,
  EPathDeclaration,
  inputFieldOf,
  type DeclaredPaths,
} from '../tools/declared-paths'
import { expandPathEnvironment } from '../tools/builtin/file-text'

export class ResolveProjectPathsHook extends BeforeToolHook {
  readonly name = 'resolveProjectPaths'
  readonly order: HookOrder = { stage: EStage.Guard, nudge: -1 }

  private readonly declaredPaths: DeclaredPaths

  constructor( tools: readonly ToolDeclaration[]) {
    super()
    this.declaredPaths = createDeclaredPaths({ tools })
  }

  readonly run: BeforeTool = async ({ call, projectDirectory }) => {
    const declaration = this.declaredPaths.forTool(call.name)
    if (declaration.kind !== EPathDeclaration.Declared) {
      return { decision: EBeforeToolDecision.Allow, input: call.input }
    }

    let input = call.input

    for (const field of declaration.fields) {
      if (field.form !== EPathForm.Absolute) continue

      const value = inputFieldOf({ input, field: field.field })
      if (value === ABSENT || typeof value !== 'string' || value.length === 0) continue

      const expanded = expandPathEnvironment({ path: value })
      if (!expanded.ok) continue

      if (isAbsolute(expanded.path)) {
        if (expanded.path !== value) {
          input = { ...(input as Record<string, unknown>), [field.field]: expanded.path }
        }
        continue
      }

      input = { ...(input as Record<string, unknown>), [field.field]: resolve(projectDirectory, expanded.path) }
    }

    return { decision: EBeforeToolDecision.Allow, input }
  }
}
