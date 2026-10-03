import { isAbsolute, resolve } from 'node:path'

import {
  BeforeToolHook,
  EBeforeToolDecision,
  EPathForm,
  EStage,
  ToolDefinition,
  type BeforeTool,
  type BeforeToolOutcome,
  type HookOrder,
  type ThreadId,
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
import {
  referencesSessionEnv,
  referencesShellEnv,
  reservedEnvironment,
  type ThreadEnvironment,
  type ThreadEnvironmentResolver,
} from './thread-environment'

type Denial = Extract<BeforeToolOutcome, { decision: EBeforeToolDecision.Deny }>

type ScopeLookup = { ok: true; scope: ThreadEnvironment } | { ok: false; denial: Denial }

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export class ResolveProjectPathsHook extends BeforeToolHook {
  readonly name = 'resolveProjectPaths'
  readonly order: HookOrder = { stage: EStage.Guard, nudge: -1 }

  private readonly declaredPaths: DeclaredPaths
  private readonly threadEnvironment: ThreadEnvironmentResolver | undefined

  constructor(
    tools: readonly ToolDeclaration[],
    args: { threadEnvironment?: ThreadEnvironmentResolver | undefined } = {},
  ) {
    super()
    this.declaredPaths = createDeclaredPaths({ tools })
    this.threadEnvironment = args.threadEnvironment
  }

  readonly run: BeforeTool = async ({ call, projectDirectory }) => {
    const declaration = this.declaredPaths.forTool(call.name)
    if (declaration.kind !== EPathDeclaration.Declared) {
      return { decision: EBeforeToolDecision.Allow, input: call.input }
    }

    let input = call.input
    let lookup: Promise<ScopeLookup> | undefined

    for (const field of declaration.fields) {
      if (field.form !== EPathForm.Absolute) continue

      const value = inputFieldOf({ input, field: field.field })
      if (value === ABSENT || typeof value !== 'string' || value.length === 0) continue

      let env: NodeJS.ProcessEnv | undefined
      if (this.threadEnvironment !== undefined && (referencesSessionEnv(value) || referencesShellEnv(value))) {
        let scope: ThreadEnvironment = {}
        if (referencesSessionEnv(value)) {
          lookup ??= this.lookupScope({ path: value, threadId: call.threadId })
          const found = await lookup
          if (!found.ok) return found.denial
          scope = found.scope
        }
        env = reservedEnvironment({ base: process.env, scope })
      }

      const expanded = expandPathEnvironment({ path: value, ...(env === undefined ? {} : { env }) })
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

  private async lookupScope(args: { path: string; threadId: ThreadId }): Promise<ScopeLookup> {
    const refuse = (why: string): ScopeLookup => ({
      ok: false,
      denial: {
        decision: EBeforeToolDecision.Deny,
        reason: `The path ${args.path} references ATLAS_SESSION_DIR or ATLAS_THREAD_DIR, but ${why}. Spell the path out, or expand it through the bash tool instead.`,
      },
    })

    try {
      const scope = await this.threadEnvironment?.({ threadId: args.threadId })
      if (scope === undefined) {
        return refuse(`thread ${args.threadId} is not registered in any session, so it has no session directory`)
      }
      return { ok: true, scope }
    } catch (error) {
      return refuse(`the session directory of thread ${args.threadId} could not be looked up: ${messageOf(error)}`)
    }
  }
}
