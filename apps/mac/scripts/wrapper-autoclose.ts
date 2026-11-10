import { planWrapperAutoclose } from './wrapper-autoclose-plan'

export function applyWrapperAutoclose(): void {
  const decision = planWrapperAutoclose({
    os: process.env.ELECTROBUN_OS,
    wrapperPath: process.env.ELECTROBUN_WRAPPER_BUNDLE_PATH,
    plutilPath: Bun.which('plutil'),
  })
  if (decision.kind === 'skip') {
    console.log(`wrapper-autoclose: skipped (${decision.reason})`)
    return
  }
  const result = Bun.spawnSync({
    cmd: decision.cmd,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (result.exitCode !== 0) {
    console.error(`wrapper-autoclose: plutil exited with ${result.exitCode}`)
    process.exit(1)
  }
  console.log(`wrapper-autoclose: set LSEnvironment in ${decision.plistPath}`)
}

if (import.meta.main) applyWrapperAutoclose()
