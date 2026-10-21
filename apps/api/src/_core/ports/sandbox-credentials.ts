export type ThreadSandboxCredentials = {
  token: string
  teamId: string
  projectId: string
  /** True when the credentials are a workspace's: the sandbox must never carry them in its env. */
  workspaceOwned: boolean
}

export abstract class SandboxCredentials {
  abstract forThread(args: { threadId: string }): Promise<ThreadSandboxCredentials>
}
