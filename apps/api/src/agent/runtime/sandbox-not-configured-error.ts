export class SandboxNotConfiguredError extends Error {
  constructor(public readonly gap: string) {
    super(`sandbox is not configured: ${gap}`)
    this.name = 'SandboxNotConfiguredError'
  }
}
