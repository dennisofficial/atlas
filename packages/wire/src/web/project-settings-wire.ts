import { z } from 'zod'

import { sandboxVcpusSchema } from './setting-enums'

export enum EShipBehavior {
  OpenPullRequest = 'open-pr',
  Push = 'push',
  Merge = 'merge',
}

export const MAX_SETUP_SCRIPT_LENGTH = 20000

export const projectSandboxSchema = z.object({
  vcpus: sandboxVcpusSchema.nullable(),
  setupScript: z.string().max(MAX_SETUP_SCRIPT_LENGTH),
})
export type ProjectSandbox = z.infer<typeof projectSandboxSchema>
