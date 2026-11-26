import {
  decodeSettingValue,
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { EAccessScope, personalFileMountPathProblem } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import type { GrantView } from '../config/cloud-config-grants'
import {
  type CloudConfigClient,
  DEFAULT_FILE_MODE,
  type ProjectCloudConfigClient,
} from '../config/cloud-config-store'
import { encodeCloudSetting, encodeProjectSetting } from '../config/setting-value'
import { done, fail, listing, reasonOf } from './cloud-outcome'

export enum ECloudConfigKind {
  Setting = 'setting',
  Secret = 'secret',
  File = 'file',
  Grant = 'grant',
}

export enum ECloudConfigAction {
  List = 'list',
  Read = 'read',
  Set = 'set',
  Remove = 'remove',
}

export const cloudConfigInputSchema = z.strictObject({
  scope: z.enum(EAccessScope).default(EAccessScope.Project),
  kind: z.enum(ECloudConfigKind),
  action: z.enum(ECloudConfigAction),
  name: z.string().min(1).optional(),
  path: z.string().min(1).optional(),
  value: z.string().optional(),
  contents: z.string().optional(),
  mode: z
    .string()
    .regex(/^0?[0-7]{3}$/, 'mode must be an octal string like 0600 or 644')
    .optional(),
  grant: z.string().min(1).optional(),
  instruction: z.string().optional(),
  newName: z.string().min(1).optional(),
})

type Input = z.output<typeof cloudConfigInputSchema>

export type CloudConfigAccess = {
  personal: CloudConfigClient
  project?: ProjectCloudConfigClient | undefined
  group?: CloudConfigClient | undefined
}

const description = [
  'Manage Atlas Cloud configuration. scope is project (the project this session runs in), group (the group that project belongs to) or personal (every project). A project value with the same name or path wins over a group one, which wins over a personal one. kind is setting, secret, file or grant. action is list, read, set or remove.',
  'Every secret and file belongs to a grant. Create the grant first with kind grant and give it an instruction that says what the access is for. A new secret or file must name its grant. A secret or file set again without a grant keeps its grant. set with a grant and no value moves an existing secret or file to that grant.',
  'A setting is an Atlas setting key; environment variables are secrets, not settings. A secret is an environment variable exported to the agent shells, named like FOO_BAR. list shows each name with its grant. Values are write-only: read is refused, set replaces.',
  'A file is mounted at path. A project path is relative to the repository. A personal path starts with ~/ or @/. set writes contents (text up to 64 KiB) with mode, an octal string like "0600" (the default) or "644".',
  'A grant is a name, an instruction and its members. read shows one grant with its members. remove deletes the grant with its secrets and files.',
  'Settings and secrets apply before the next turn. Files are written on the next sandbox start. Without a project, only scope personal works; scope group needs a project that belongs to a group.',
].join(' ')

const OCTAL_RADIX = 8

const need = (args: { value: string | undefined; field: string }): string | ToolOutcome =>
  args.value === undefined ? fail(`${args.field} is required for this action`) : args.value

const isFailure = (value: string | ToolOutcome): value is ToolOutcome => typeof value !== 'string'

const isOutcome = (value: CloudConfigClient | ToolOutcome): value is ToolOutcome => 'ok' in value

const clientOf = (args: {
  access: CloudConfigAccess
  input: Input
}): CloudConfigClient | ToolOutcome => {
  if (args.input.scope === EAccessScope.Personal) return args.access.personal
  const client = args.input.scope === EAccessScope.Group ? args.access.group : args.access.project
  return client === undefined ? fail('this session has no project; use scope personal') : client
}

const settings = async (args: {
  client: CloudConfigClient
  input: Input
}): Promise<ToolOutcome> => {
  const { client, input } = args
  if (input.action === ECloudConfigAction.List) {
    const rows = await client.listSettings()
    return listing({
      title: 'settings',
      lines: rows.map((row) => `${row.key} = ${JSON.stringify(decodeSettingValue(row.value))}`),
    })
  }
  const name = need({ value: input.name, field: 'name' })
  if (isFailure(name)) return name
  if (input.action === ECloudConfigAction.Read) {
    const row = await client.readSetting(name)
    return row === null
      ? fail(`there is no setting "${name}"`)
      : done({
          text: `${row.key} = ${JSON.stringify(decodeSettingValue(row.value))}`,
          output: { key: row.key },
        })
  }
  if (input.action === ECloudConfigAction.Remove) {
    const removed = await client.removeSetting(name)
    return removed
      ? done({ text: `Removed setting ${name}.` })
      : fail(`there is no setting "${name}"`)
  }
  const value = need({ value: input.value, field: 'value' })
  if (isFailure(value)) return value
  const encoded =
    client.scope === EAccessScope.Personal
      ? encodeCloudSetting({ key: name, raw: value })
      : encodeProjectSetting({ key: name, raw: value })
  if (!encoded.ok) return fail(encoded.reason)
  await client.setSetting({ key: name, stored: encoded.stored })
  return done({ text: `Set setting ${name}.` })
}

const secrets = async (args: { client: CloudConfigClient; input: Input }): Promise<ToolOutcome> => {
  const { client, input } = args
  if (input.action === ECloudConfigAction.List) {
    const rows = await client.listSecrets()
    return listing({
      title: 'secret names',
      lines: rows.map((row) => `${row.name} (${row.grant})`),
    })
  }
  if (input.action === ECloudConfigAction.Read) {
    return fail('secret values are write-only; list shows their names')
  }
  const name = need({ value: input.name, field: 'name' })
  if (isFailure(name)) return name
  if (input.action === ECloudConfigAction.Remove) {
    const removed = await client.removeSecret(name)
    return removed
      ? done({ text: `Removed secret ${name}.` })
      : fail(`there is no secret "${name}"`)
  }
  if (input.value === undefined && input.grant !== undefined) {
    const moved = await client.moveSecret({ name, grant: input.grant })
    return moved
      ? done({ text: `Moved secret ${name} to grant ${input.grant}.` })
      : fail(`there is no secret "${name}"`)
  }
  const value = need({ value: input.value, field: 'value' })
  if (isFailure(value)) return value
  await client.setSecret({ name, value, grant: input.grant })
  return done({ text: `Set secret ${name}.` })
}

const files = async (args: { client: CloudConfigClient; input: Input }): Promise<ToolOutcome> => {
  const { client, input } = args
  if (input.action === ECloudConfigAction.List) {
    const rows = await client.listFileMounts()
    return listing({
      title: 'file mounts',
      lines: rows.map((row) => `${row.path} (mode ${row.mode.toString(8)}, ${row.grant})`),
    })
  }
  if (input.action === ECloudConfigAction.Read) {
    return fail('a file mount’s contents are not readable here; set replaces it')
  }
  const path = need({ value: input.path, field: 'path' })
  if (isFailure(path)) return path
  if (input.action === ECloudConfigAction.Remove) {
    const removed = await client.removeFileMount(path)
    return removed
      ? done({ text: `Removed file mount ${path}.` })
      : fail(`there is no file mount "${path}"`)
  }
  if (client.scope === EAccessScope.Personal) {
    const problem = personalFileMountPathProblem(path)
    if (problem !== null) return fail(problem)
  }
  if (input.contents === undefined && input.grant !== undefined) {
    const moved = await client.moveFileMount({ path, grant: input.grant })
    return moved
      ? done({ text: `Moved file mount ${path} to grant ${input.grant}.` })
      : fail(`there is no file mount "${path}"`)
  }
  const contents = need({ value: input.contents, field: 'contents' })
  if (isFailure(contents)) return contents
  const mode =
    input.mode === undefined ? DEFAULT_FILE_MODE : Number.parseInt(input.mode, OCTAL_RADIX)
  await client.setFileMount({ path, contents, mode, grant: input.grant })
  return done({ text: `Set file mount ${path}. It is written on the next sandbox start.` })
}

const grantText = (grant: GrantView): string => {
  const secrets = grant.secrets.length === 0 ? 'none' : grant.secrets.join(', ')
  const files =
    grant.files.length === 0
      ? 'none'
      : grant.files.map((file) => `${file.path} (mode ${file.mode.toString(8)})`).join(', ')
  const instruction = grant.instruction.trim()
  return [
    `grant ${grant.name}`,
    `Environment variables: ${secrets}`,
    `Files: ${files}`,
    `Instruction: ${instruction === '' ? 'none' : instruction}`,
  ].join('\n')
}

const grants = async (args: { client: CloudConfigClient; input: Input }): Promise<ToolOutcome> => {
  const { client, input } = args
  if (input.action === ECloudConfigAction.List) {
    const rows = await client.listGrants()
    return listing({ title: 'access grants', lines: rows.map((grant) => grant.name) })
  }
  const name = need({ value: input.name, field: 'name' })
  if (isFailure(name)) return name
  if (input.action === ECloudConfigAction.Read) {
    const grant = await client.readGrant(name)
    return grant === null
      ? fail(`there is no grant "${name}"`)
      : done({ text: grantText(grant), output: { name: grant.name } })
  }
  if (input.action === ECloudConfigAction.Remove) {
    const removed = await client.removeGrant(name)
    return removed
      ? done({ text: `Removed grant ${name} with its environment variables and files.` })
      : fail(`there is no grant "${name}"`)
  }
  await client.setGrant({ name, instruction: input.instruction, newName: input.newName })
  return done({
    text:
      input.newName === undefined
        ? `Set grant ${name}.`
        : `Renamed grant ${name} to ${input.newName}.`,
  })
}

export class CloudConfigTool extends SchemaTool<typeof cloudConfigInputSchema> {
  readonly name = 'cloud_config'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = cloudConfigInputSchema
  readonly deferred = true
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly access: CloudConfigAccess) {
    super()
  }

  protected override async run({
    input,
  }: ToolRun<typeof cloudConfigInputSchema>): Promise<ToolOutcome> {
    const client = clientOf({ access: this.access, input })
    if (isOutcome(client)) return client
    try {
      if (input.kind === ECloudConfigKind.Setting) return await settings({ client, input })
      if (input.kind === ECloudConfigKind.Secret) return await secrets({ client, input })
      if (input.kind === ECloudConfigKind.Grant) return await grants({ client, input })
      return await files({ client, input })
    } catch (error) {
      return fail(reasonOf(error))
    }
  }
}
