import type { Sandbox } from '@vercel/sandbox'

export type SandboxSh = (args: {
  sandbox: Sandbox
  script: string
  timeoutMs?: number
  env?: Record<string, string>
}) => ReturnType<Sandbox['runCommand']>

export const sandboxSh: SandboxSh = (args) =>
  args.sandbox.runCommand({
    cmd: 'sh',
    args: ['-c', args.script],
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    ...(args.env === undefined ? {} : { env: args.env }),
  })
