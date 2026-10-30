import {
  EToolEffect,
  SchemaTool,
  TAKES_NO_PATHS,
  type ToolOutcome,
  type ToolRun,
} from '@dltech/atlas-core'

import type { CloudConfigAccessSource } from '../../cloud/cloud-config-access'

import { cloudConfigInputSchema, ECloudConfigScope } from './cloud-config-input'
import {
  NOT_SIGNED_IN,
  runCloudConfig,
  type CloudConfigTarget,
  SANDBOX_PERSONAL_REFUSAL,
} from './cloud-config-run'

const description = [
  'Read and change Atlas Cloud configuration for the session project, or for the signed-in user.',
  'scope is project or personal; kind is setting, secret, mcp or file; action is list, read, set or remove.',
  'Files exist only in project scope: path is repo-relative or starts with ~/, contents is text up to 64 KiB, mode is an octal string like "0600" (the default) or "644".',
  'setting covers Atlas setting keys only; kind secret is an environment variable (name like FOO_BAR) exported to the agent shells and services.',
  'list never returns secret or file values. read returns them: do not echo them to the user unless asked.',
  'Settings and secrets apply before the next turn. Files and mcp servers apply on the next sandbox start.',
  'Personal scope cannot be read or changed from a cloud sandbox. projectId defaults to the project of this session.',
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
    if (personal && access.inSandbox) return { ok: false, reason: SANDBOX_PERSONAL_REFUSAL }
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
