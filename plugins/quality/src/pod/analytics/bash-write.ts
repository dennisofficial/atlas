import {
  EDeed,
  EDeedRealm,
  EPathDeclaration,
  deedsOf,
  isUnderPath,
  normalisePath,
  readCommand,
  resolveAgainst,
  type ToolCall,
} from '@dltech/atlas-core'

const SHELL_TOOL_NAME = 'bash'

type ShellInput = { command: string; workdir: string | undefined }

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const shellInputOf = (input: unknown): ShellInput | undefined => {
  if (typeof input !== 'object' || input === null) return undefined
  const command = nonEmptyString(Reflect.get(input, 'command'))
  if (command === undefined) return undefined
  return { command, workdir: nonEmptyString(Reflect.get(input, 'workdir')) }
}

export const writesIntoWorkspace = ({
  call,
  projectDirectory,
}: {
  call: ToolCall
  projectDirectory: string
}): boolean => {
  if (call.name !== SHELL_TOOL_NAME) return false
  const shell = shellInputOf(call.input)
  if (shell === undefined) return false

  const workspace = normalisePath({ path: projectDirectory })
  const deeds = deedsOf({
    call,
    declaration: { kind: EPathDeclaration.Declared, fields: [] },
    reading: readCommand({
      command: shell.command,
      workdir: shell.workdir,
      projectDirectory: workspace,
    }),
    projectDirectory: workspace,
  })

  return deeds.some(
    (deed) =>
      deed.action === EDeed.WriteFile &&
      deed.targets.some(
        (target) =>
          target.realm === EDeedRealm.Path &&
          isUnderPath({
            directory: workspace,
            path: resolveAgainst({ base: deed.cwd ?? workspace, path: target.value }),
          }),
      ),
  )
}
