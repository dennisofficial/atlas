import {
  ProcessPort,
  type PortExposureOutcome,
  type ProcessHandle,
  type SpawnCommand,
} from '@dltech/atlas-core'

export class LocalProcessPort extends ProcessPort {
  override async exposePort(args: { containerPort: number }): Promise<PortExposureOutcome> {
    return {
      ok: true,
      exposure: {
        containerPort: args.containerPort,
        hostPort: args.containerPort,
        url: `http://localhost:${args.containerPort}`,
      },
    }
  }

  spawn(args: SpawnCommand): ProcessHandle {
    const child = Bun.spawn({
      cmd: [...args.cmd],
      cwd: args.cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
      env: args.env ?? process.env,
    })
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      exited: child.exited,
      terminate: () => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
      },
    }
  }

  override async launchDetached(args: SpawnCommand): Promise<void> {
    Bun.spawn({
      cmd: [...args.cmd],
      cwd: args.cwd,
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      detached: true,
      env: args.env ?? process.env,
    }).unref()
  }

  override which(args: { command: string }): string | null {
    return Bun.which(args.command)
  }
}
