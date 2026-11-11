import {
  ArtifactSandbox,
  type ArtifactSandboxCommand,
  type ArtifactSandboxFile,
  type ArtifactSandboxRequest,
  type ArtifactSandboxResult,
} from './artifact-sandbox'

export const finishedCommand = (
  args: Partial<ArtifactSandboxCommand> = {},
): ArtifactSandboxCommand => ({
  exitCode: args.exitCode ?? 0,
  stdout: args.stdout ?? '',
  stderr: args.stderr ?? '',
  timedOut: args.timedOut ?? false,
})

export const builtFiles = (
  files: readonly { path: string; body: string }[],
): ArtifactSandboxFile[] =>
  files.map((file) => ({ path: file.path, content: Buffer.from(file.body) }))

export const sandboxResult = (args: {
  install?: ArtifactSandboxCommand | null
  build?: ArtifactSandboxCommand | null
  outDir?: readonly ArtifactSandboxFile[]
}): ArtifactSandboxResult => ({
  install: args.install === undefined ? finishedCommand() : args.install,
  build: args.build === undefined ? finishedCommand() : args.build,
  outDir: args.outDir ?? [],
})

export class FakeArtifactSandbox extends ArtifactSandbox {
  readonly requests: ArtifactSandboxRequest[] = []
  private readonly script: ArtifactSandboxResult[] = []

  reset(): void {
    this.requests.length = 0
    this.script.length = 0
  }

  scripted(...results: ArtifactSandboxResult[]): void {
    this.script.push(...results)
  }

  get lastRequest(): ArtifactSandboxRequest {
    const request = this.requests.at(-1)
    if (request === undefined) throw new Error('the fake sandbox was never asked to build')
    return request
  }

  async run(request: ArtifactSandboxRequest): Promise<ArtifactSandboxResult> {
    this.requests.push(request)
    const next = this.script.shift()
    if (next === undefined) throw new Error('the fake sandbox has no scripted result left')
    return next
  }
}
