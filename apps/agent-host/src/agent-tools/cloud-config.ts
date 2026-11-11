import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'
import { decodeSettingValue } from '@dltech/atlas-wire/web'
import { z } from 'zod'

import { DEFAULT_FILE_MODE, type CloudConfigClient } from '../config/cloud-config-store'
import { encodeProjectSetting } from '../config/setting-value'
import { done, fail, foreignProject, listing, reasonOf } from './cloud-outcome'

export enum ECloudConfigKind {
  Setting = 'setting',
  Secret = 'secret',
  File = 'file',
}

export enum ECloudConfigAction {
  List = 'list',
  Read = 'read',
  Set = 'set',
  Remove = 'remove',
}

export const cloudConfigInputSchema = z.strictObject({
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
})

type Input = z.output<typeof cloudConfigInputSchema>

const description = [
  'Read and change Atlas configuration for the project this session runs in.',
  'kind is setting, secret or file; action is list, read, set or remove.',
  'setting is an Atlas setting key and value is its new value; environment variables are secrets, not settings.',
  'secret is an environment variable exported to the agent shells and services, named like FOO_BAR: list returns names only, read is refused, set replaces the value and remove deletes it.',
  'file is a file mounted in the sandbox at path, repo-relative or starting with ~/: set writes contents (text up to 64 KiB) with mode, an octal string like "0600" (the default) or "644"; it is written on the next sandbox start.',
  'Settings and secrets apply before the next turn. There is no projectId: this session can only change its own project.',
].join(' ')

const OCTAL_RADIX = 8

const need = (args: { value: string | undefined; field: string }): string | ToolOutcome =>
  args.value === undefined ? fail(`${args.field} is required for this action`) : args.value

const isFailure = (value: string | ToolOutcome): value is ToolOutcome => typeof value !== 'string'

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
  const encoded = encodeProjectSetting({ key: name, raw: value })
  if (!encoded.ok) return fail(encoded.reason)
  await client.setSetting({ key: name, stored: encoded.stored })
  return done({ text: `Set setting ${name}.` })
}

const secrets = async (args: { client: CloudConfigClient; input: Input }): Promise<ToolOutcome> => {
  const { client, input } = args
  if (input.action === ECloudConfigAction.List) {
    return listing({ title: 'secret names', lines: await client.listSecretNames() })
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
  const value = need({ value: input.value, field: 'value' })
  if (isFailure(value)) return value
  await client.setSecret({ name, value })
  return done({ text: `Set secret ${name}.` })
}

const files = async (args: { client: CloudConfigClient; input: Input }): Promise<ToolOutcome> => {
  const { client, input } = args
  if (input.action === ECloudConfigAction.List) {
    const rows = await client.listFileMounts()
    return listing({
      title: 'file mounts',
      lines: rows.map((row) => `${row.path} (mode ${row.mode.toString(8)})`),
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
  const contents = need({ value: input.contents, field: 'contents' })
  if (isFailure(contents)) return contents
  const mode =
    input.mode === undefined ? DEFAULT_FILE_MODE : Number.parseInt(input.mode, OCTAL_RADIX)
  await client.setFileMount({ path, contents, mode })
  return done({ text: `Set file mount ${path}. It is written on the next sandbox start.` })
}

export class CloudConfigTool extends SchemaTool<typeof cloudConfigInputSchema> {
  readonly name = 'cloud_config'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = cloudConfigInputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly access: { client: CloudConfigClient; projectId: string }) {
    super()
  }

  protected override async run({
    input,
  }: ToolRun<typeof cloudConfigInputSchema>): Promise<ToolOutcome> {
    const { client, projectId } = this.access
    const foreign = foreignProject({ own: projectId, bound: client.projectId })
    if (foreign !== undefined) return foreign
    try {
      if (input.kind === ECloudConfigKind.Setting) return await settings({ client, input })
      if (input.kind === ECloudConfigKind.Secret) return await secrets({ client, input })
      return await files({ client, input })
    } catch (error) {
      return fail(reasonOf(error))
    }
  }
}
