import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { PLUGIN_API_MODULES, atlasPluginApi } from '../api'
import { PLUGIN_TYPES_FILE_NAME } from '../../plugin-types/constants'
import { materializePluginTypes } from '../../plugin-types/materialize'
import { PLUGIN_TYPES_TEXT } from '../../plugin-types/plugin-types.generated'

const TSC = join(dirname(Bun.resolveSync('typescript/package.json', import.meta.dir)), 'bin', 'tsc')

describe('the shipped types and the curated api', () => {
  it('is one ambient module named atlas with no import of anything outside itself', () => {
    expect(PLUGIN_TYPES_TEXT).toContain("declare module 'atlas' {")
    expect(PLUGIN_TYPES_TEXT).not.toMatch(/from '[^']*'|import\(/)
  })

  it('claims a companion type only for a name the api actually exports', () => {
    const claimed = PLUGIN_API_MODULES.flatMap((module) => module.valueTypes)

    expect(claimed.filter((name) => !(name in atlasPluginApi))).toEqual([])
  })

  it('exports every value atlasPluginApi exports', () => {
    const exported = [
      ...PLUGIN_TYPES_TEXT.matchAll(
        /^ {0,2}export (?:declare )?(?:const|function|class|abstract class|enum) (\w+)/gm,
      ),
    ].map((match) => match[1])
    const missing = Object.keys(atlasPluginApi).filter((name) => !exported.includes(name))

    expect(missing).toEqual([])
  })
})

describe('a fixture plugin typechecked against the materialized file alone', () => {
  it('resolves every name it imports and types a hook body without an implicit any', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'atlas-plugin-types-'))
    await materializePluginTypes({ home: directory })
    const declared = join(directory, 'types', PLUGIN_TYPES_FILE_NAME)

    writeFileSync(
      join(directory, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          lib: ['ES2023', 'DOM'],
          module: 'Preserve',
          moduleResolution: 'bundler',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: [],
          verbatimModuleSyntax: true,
        },
        files: ['./fixture.ts', declared],
      }),
    )

    writeFileSync(
      join(directory, 'fixture.ts'),
      `
import { definePlugin, EBeforeToolDecision, EHookPhase, EStage, EToolEffect, readCommand } from 'atlas'
import type { BeforeToolOutcome, PluginContribution, PluginHost, ToolCall } from 'atlas'

const decide = async (args: {
  call: ToolCall
  projectDirectory: string
}): Promise<BeforeToolOutcome> => {
  const reading = readCommand({
    command: String(args.call.input),
    workdir: undefined,
    projectDirectory: args.projectDirectory,
  })

  if (args.call.effect === EToolEffect.Read || reading.segments.length === 0) {
    return { decision: EBeforeToolDecision.Allow, input: args.call.input }
  }

  return { decision: EBeforeToolDecision.Deny, reason: 'this repo uses bun' }
}

export default definePlugin({
  id: 'comp-conventions',
  register: (host: PluginHost): PluginContribution => ({
    hooks: [
      {
        phase: EHookPhase.BeforeTool,
        name: host.id,
        order: { stage: EStage.Guard, nudge: 10 },
        run: async ({ call, projectDirectory }) => await decide({ call, projectDirectory }),
      },
    ],
  }),
})
`,
    )

    const checked = Bun.spawn(['bun', TSC, '--noEmit', '-p', directory], {
      cwd: directory,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const reported = await new Response(checked.stdout).text()

    expect(reported.trim()).toBe('')
    expect(await checked.exited).toBe(0)
  }, 120_000)
})
