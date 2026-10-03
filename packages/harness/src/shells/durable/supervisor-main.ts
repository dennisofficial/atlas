import { runShellSupervisor } from './supervisor'

export async function runSupervisorCli({ argv }: { argv: readonly string[] }): Promise<void> {
  const code = await runShellSupervisor(argv)
  process.exit(code)
}

if (import.meta.main) await runSupervisorCli({ argv: process.argv.slice(2) })
