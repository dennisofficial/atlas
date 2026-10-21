import { z } from 'zod'

export enum EShipBehavior {
  OpenPullRequest = 'open-pr',
  Push = 'push',
  Merge = 'merge',
}

export const MAX_SETUP_SCRIPT_LENGTH = 20000

export const projectSandboxSchema = z.object({
  vcpus: z
    .number()
    .int()
    .min(2)
    .max(8)
    .refine((value) => value % 2 === 0, { message: 'must be an even number' })
    .nullable(),
  setupScript: z.string().max(MAX_SETUP_SCRIPT_LENGTH),
})
export type ProjectSandbox = z.infer<typeof projectSandboxSchema>
