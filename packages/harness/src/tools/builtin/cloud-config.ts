import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { CloudConfigAccessSource } from '../../cloud/cloud-config-access'

import { cloudConfigInputSchema, ECloudConfigScope } from './cloud-config-input'
import { NOT_SIGNED_IN, runCloudConfig, type CloudConfigTarget } from './cloud-config-run'

const description = [
  'Read and change Atlas Cloud configuration for the session project, or for the signed-in user.',
  'scope is project or personal; kind is setting, secret, mcp, file or skill; action is list, read, set or remove.',
  'Files exist only in project scope: path is repo-relative or starts with ~/, contents is text up to 64 KiB, mode is an octal string like "0600" (the default) or "644".',
  'setting covers Atlas setting keys only; kind secret is an environment variable (name like FOO_BAR) exported to the agent shells and services.',
  'list never returns secret or file values. read returns them: do not echo them to the user unless asked.',
  'Settings and secrets apply before the next turn. Files and mcp servers apply on the next sandbox start.',
  'skill manages skill files at path <skill>/<file>: list with path <skill> shows one skill\'s files, remove with path <skill> deletes the whole skill, contents is utf8 text only and always overwrites (a "changed since" conflict means read the file again and retry). On-disk copies in sandboxes are overwritten from Atlas Cloud at the next pod start, so edit skills through this tool, never by writing the files. Skill edits apply to running sessions at the next turn.',
  'projectId defaults to the project of this session.',
].join(' ')

export class CloudConfigTool extends SchemaTool<typeof cloudConfigInputSchema> {
  readonly name = 'cloud_config'
  readonly description = description
  readonly effect = EToolEffect.Write
  readonly inputSchema = cloudConfigInputSchema
  override readonly pathFields = TAKES_NO_PATHS

  constructor(private readonly access: CloudConfigAccessSource) {
    super()
  }

  protected override async run({
    input,
    threadId,
  }: ToolRun<typeof cloudConfigInputSchema>): Promise<ToolOutcome> {
    const access = await this.access({ threadId })
    if (access === null) return { ok: false, reason: NOT_SIGNED_IN }
    const personal = input.scope === ECloudConfigScope.Personal
    const projectId = input.projectId ?? access.projectId
    if (projectId === null && !personal) {
      return { ok: false, reason: 'this session has no Atlas Cloud project; pass projectId' }
    }
    const target: CloudConfigTarget =
      personal || projectId === null ? { personal: true } : { personal: false, projectId }
    try {
      return await runCloudConfig({ client: access.client, input, target })
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : String(error) }
    }
  }
}
