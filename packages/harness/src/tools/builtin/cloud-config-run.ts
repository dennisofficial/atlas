import { createHash } from 'node:crypto'

import type { ToolOutcome } from '@dltech/atlas-core'
import { EMcpTransportKind, ESkillScope, type McpTransportWire } from '@dltech/atlas-wire'
import { decodeSettingValue } from '@dltech/atlas-wire/web'
import type { ApiClient } from '@dltech/atlas-api-router'

import { cloudCall } from '../../cloud/api-trpc-client'

import { ECloudConfigAction, ECloudConfigKind, type CloudConfigInput } from './cloud-config-input'
import { encodeToolSetting } from './cloud-config-setting'

export const NOT_SIGNED_IN = 'Not signed in to Atlas Cloud'

const fail = (reason: string): ToolOutcome => ({ ok: false, reason })

const done = (args: { text: string; output?: unknown }): ToolOutcome => ({
  ok: true,
  output: args.output ?? { message: args.text },
  modelText: args.text,
})

const listing = (args: { title: string; lines: readonly string[] }): ToolOutcome =>
  done({
    text:
      args.lines.length === 0 ? `No ${args.title}.` : `${args.title}:\n${args.lines.join('\n')}`,
    output: { count: args.lines.length },
  })

const OCTAL_RADIX = 8

const keysNote = (args: { label: string; record: Record<string, string> | undefined }): string => {
  const keys = Object.keys(args.record ?? {})
  return keys.length === 0 ? '' : ` ${args.label}: ${keys.join(', ')}`
}

const mcpLine = (row: { name: string; transport?: McpTransportWire | undefined }): string => {
  const { transport } = row
  if (transport === undefined) return `${row.name} (no transport)`
  if (transport.kind === EMcpTransportKind.Http) {
    return `${row.name} http ${transport.url}${keysNote({ label: 'headers', record: transport.headers })}`
  }
  return `${row.name} stdio ${transport.command}${keysNote({ label: 'env', record: transport.env })}`
}

export type CloudConfigTarget = { personal: true } | { personal: false; projectId: string }

type Scoped = { client: ApiClient; input: CloudConfigInput; target: CloudConfigTarget }

const need = (args: { value: string | undefined; field: string }): string | ToolOutcome =>
  args.value === undefined ? fail(`${args.field} is required for this action`) : args.value

const isFailure = (value: string | ToolOutcome): value is ToolOutcome => typeof value !== 'string'

const settings = async ({ client, input, target }: Scoped): Promise<ToolOutcome> => {
  if (input.action === ECloudConfigAction.List || input.action === ECloudConfigAction.Read) {
    const body = await cloudCall(
      target.personal
        ? client.settings.list.query()
        : client.projectResources.listSettings.query({ projectId: target.projectId }),
    )
    const rows = body.settings.filter(
      (row) => input.action === ECloudConfigAction.List || row.key === input.name,
    )
    if (input.action === ECloudConfigAction.Read && rows.length === 0) {
      return fail(`there is no setting "${input.name ?? ''}"`)
    }
    return listing({
      title: 'settings',
      lines: rows.map((row) => `${row.key} = ${JSON.stringify(decodeSettingValue(row.value))}`),
    })
  }
  const key = need({ value: input.name, field: 'name' })
  if (isFailure(key)) return key
  if (input.action === ECloudConfigAction.Remove) {
    await cloudCall(
      target.personal
        ? client.settings.remove.mutate({ key })
        : client.projectResources.patchSettings.mutate({
            projectId: target.projectId,
            values: { [key]: null },
          }),
    )
    return done({ text: `Removed setting ${key}.` })
  }
  const value = need({ value: input.value, field: 'value' })
  if (isFailure(value)) return value
  const encoded = encodeToolSetting({ key, raw: value, personal: target.personal })
  if (!encoded.ok) return fail(encoded.reason)
  const stored = encoded.stored
  await cloudCall(
    target.personal
      ? client.settings.set.mutate({ key, value: stored })
      : client.projectResources.patchSettings.mutate({
          projectId: target.projectId,
          values: { [key]: stored },
        }),
  )
  return done({ text: `Set setting ${key}.` })
}

const secrets = async ({ client, input, target }: Scoped): Promise<ToolOutcome> => {
  if (input.action === ECloudConfigAction.List) {
    const body = await cloudCall(
      target.personal
        ? client.secrets.details.query()
        : client.projectResources.listSecrets.query({ projectId: target.projectId }),
    )
    return listing({ title: 'secret names', lines: body.secrets.map((row) => row.name) })
  }
  const name = need({ value: input.name, field: 'name' })
  if (isFailure(name)) return name
  if (input.action === ECloudConfigAction.Read) {
    const body = await cloudCall(
      target.personal
        ? client.secrets.reveal.query({ name })
        : client.projectResources.revealSecret.query({ projectId: target.projectId, name }),
    )
    return done({ text: body.value, output: { name } })
  }
  if (input.action === ECloudConfigAction.Remove) {
    await cloudCall(
      target.personal
        ? client.secrets.remove.mutate({ name })
        : client.projectResources.removeSecret.mutate({ projectId: target.projectId, name }),
    )
    return done({ text: `Removed secret ${name}.` })
  }
  const value = need({ value: input.value, field: 'value' })
  if (isFailure(value)) return value
  await cloudCall(
    target.personal
      ? client.secrets.set.mutate({ name, value })
      : client.projectResources.setSecret.mutate({ projectId: target.projectId, name, value }),
  )
  return done({ text: `Set secret ${name}.` })
}

const mcp = async ({ client, input, target }: Scoped): Promise<ToolOutcome> => {
  if (input.action === ECloudConfigAction.List || input.action === ECloudConfigAction.Read) {
    const body = await cloudCall(
      target.personal
        ? client.mcpServers.list.query()
        : client.projectResources.listMcpServers.query({ projectId: target.projectId }),
    )
    const rows = body.servers.filter(
      (row) => input.action === ECloudConfigAction.List || row.name === input.name,
    )
    if (input.action === ECloudConfigAction.Read && rows.length === 0) {
      return fail(`there is no mcp server "${input.name ?? ''}"`)
    }
    return listing({
      title: 'mcp servers',
      lines:
        input.action === ECloudConfigAction.List
          ? rows.map(mcpLine)
          : rows.map((row) => JSON.stringify(row)),
    })
  }
  const name = need({ value: input.name, field: 'name' })
  if (isFailure(name)) return name
  if (input.action === ECloudConfigAction.Remove) {
    await cloudCall(
      target.personal
        ? client.mcpServers.remove.mutate({ name })
        : client.projectResources.removeMcpServer.mutate({ projectId: target.projectId, name }),
    )
    return done({ text: `Removed mcp server ${name}. It applies on the next sandbox start.` })
  }
  if (input.transport === undefined) return fail('transport is required for this action')
  const { transport } = input
  await cloudCall(
    target.personal
      ? client.mcpServers.put.mutate({ name, transport })
      : client.projectResources.putMcpServer.mutate({
          projectId: target.projectId,
          name,
          transport,
        }),
  )
  return done({ text: `Set mcp server ${name}. It applies on the next sandbox start.` })
}

const files = async ({ client, input, target }: Scoped): Promise<ToolOutcome> => {
  if (target.personal) return fail('files exist only in project scope')
  if (input.action === ECloudConfigAction.List) {
    const body = await cloudCall(
      client.projectResources.listFileMounts.query({ projectId: target.projectId }),
    )
    return listing({
      title: 'file mounts',
      lines: body.mounts.map((row) => `${row.path} (mode ${row.mode.toString(8)})`),
    })
  }
  const path = need({ value: input.path, field: 'path' })
  if (isFailure(path)) return path
  if (input.action === ECloudConfigAction.Read) {
    const body = await cloudCall(
      client.projectResources.revealFileMount.query({ projectId: target.projectId, path }),
    )
    return done({ text: body.contents, output: { path } })
  }
  if (input.action === ECloudConfigAction.Remove) {
    await cloudCall(
      client.projectResources.removeFileMount.mutate({ projectId: target.projectId, path }),
    )
    return done({ text: `Removed file mount ${path}.` })
  }
  const contents = need({ value: input.contents, field: 'contents' })
  if (isFailure(contents)) return contents
  await cloudCall(
    client.projectResources.setFileMount.mutate({
      projectId: target.projectId,
      path,
      contents,
      ...(input.mode === undefined ? {} : { mode: Number.parseInt(input.mode, OCTAL_RADIX) }),
    }),
  )
  return done({ text: `Set file mount ${path}. It is written on the next sandbox start.` })
}

const skills = async ({ client, input, target }: Scoped): Promise<ToolOutcome> => {
  const scope = target.personal
    ? ({ scope: ESkillScope.Personal } as const)
    : ({ scope: ESkillScope.Project, projectId: target.projectId } as const)
  const path = input.path
  if (input.action === ECloudConfigAction.List) {
    if (path === undefined) {
      const body = await cloudCall(client.skills.list.query(scope))
      return listing({
        title: 'skills',
        lines: body.skills.map(
          (row) => `${row.name} — ${row.description} (${row.fileCount} files, ${row.sizeBytes} B)`,
        ),
      })
    }
    const body = await cloudCall(client.skills.listFiles.query({ ...scope, skill: path }))
    return listing({
      title: `files of skill ${path}`,
      lines: body.files.map((row) => `${row.path} (${row.sizeBytes} B)`),
    })
  }
  if (path === undefined) return fail('path is required for this action')
  const skill = path.split('/')[0] ?? ''
  const file = path.includes('/') ? path.slice(path.indexOf('/') + 1) : undefined
  if (input.action === ECloudConfigAction.Read) {
    if (file === undefined || file.length === 0) {
      return fail('read needs a file: path is <skill>/<file>')
    }
    const body = await cloudCall(client.skills.get.query({ ...scope, skill, path: file }))
    if (!body.isText) {
      return fail(`binary skill file; replace it from the web settings page`)
    }
    return done({ text: Buffer.from(body.content, 'base64').toString('utf8'), output: { path } })
  }
  if (input.action === ECloudConfigAction.Remove) {
    if (file === undefined || file.length === 0) {
      const body = await cloudCall(client.skills.removeSkill.mutate({ ...scope, skill }))
      return done({ text: `Removed skill ${skill} (${body.removed} files).` })
    }
    await cloudCall(client.skills.remove.mutate({ ...scope, skill, path: file, baseRevision: 0 }))
    return done({ text: `Removed file ${path}.` })
  }
  if (file === undefined || file.length === 0) {
    return fail('set needs a file: path is <skill>/<file>')
  }
  const contents = need({ value: input.contents, field: 'contents' })
  if (isFailure(contents)) return contents
  const bytes = Buffer.from(contents, 'utf8')
  await cloudCall(
    client.skills.put.mutate({
      ...scope,
      skill,
      path: file,
      content: bytes.toString('base64'),
      contentHash: createHash('sha256').update(bytes).digest('hex'),
    }),
  )
  return done({ text: `Set skill file ${path}.` })
}

export const runCloudConfig = (args: Scoped): Promise<ToolOutcome> => {
  if (args.input.kind === ECloudConfigKind.Setting) return settings(args)
  if (args.input.kind === ECloudConfigKind.Secret) return secrets(args)
  if (args.input.kind === ECloudConfigKind.Mcp) return mcp(args)
  if (args.input.kind === ECloudConfigKind.Skill) return skills(args)
  return files(args)
}
