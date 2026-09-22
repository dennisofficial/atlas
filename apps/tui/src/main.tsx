import { bootAtlas } from './composition/boot'
import { BOOT_FAILURE_EXIT_CODE, bootFailureReport } from './composition/boot-failure'
import { launchCommand } from './composition/launch-command'
import { promoteStagedUpdate } from './composition/promote-staged'
import { versionLabel } from './build/info'

export const APP_PACKAGE_NAME = '@dltech/atlas'

const report = (error: unknown): void => {
  process.stderr.write(bootFailureReport({ error, debug: process.env.ATLAS_DEBUG !== undefined }))
}

const boot = (): void => {
  bootAtlas({
    argv: process.argv.slice(2),
    env: process.env,
    cwd: process.cwd(),
    command: launchCommand({ execPath: process.execPath, entry: process.argv[1] }),
  })
    .then((exitCode) => {
      if (exitCode !== 0) process.exitCode = exitCode
    })
    .catch((error: unknown) => {
      report(error)
      process.exitCode = BOOT_FAILURE_EXIT_CODE
    })
}

if (import.meta.main) {
  if (process.argv.slice(2).includes('--version')) {
    process.stdout.write(`atlas ${versionLabel()}\n`)
  } else {
    void promoteStagedUpdate({
      execPath: process.execPath,
      argv: process.argv.slice(2),
    }).then(boot)
  }
}
