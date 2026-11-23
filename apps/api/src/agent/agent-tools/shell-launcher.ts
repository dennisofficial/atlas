export type ShellLaunchArgs = {
  shellId: string
  command: string
  cwd: string
  env: Record<string, string>
  timeoutMs?: number | undefined
  input: boolean
  signal: AbortSignal
}

export type ShellLaunchOutcome = { ok: true; pid: number } | { ok: false; reason: string }

export abstract class ShellLauncher {
  abstract launch(args: ShellLaunchArgs): Promise<ShellLaunchOutcome>
}
