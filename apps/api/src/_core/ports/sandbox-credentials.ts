export type ThreadSandboxCredentials = {
  token: string
  teamId: string
  projectId: string
  /** True when the credentials are the thread owner's: the sandbox must never carry them in its env. */
  ownerCredential: boolean
}

export abstract class SandboxCredentials {
  abstract forThread(args: { threadId: string }): Promise<ThreadSandboxCredentials>
}
