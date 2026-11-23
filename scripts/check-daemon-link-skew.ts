import { $ } from 'bun'

import {
  daemonLinkFactsOf,
  daemonLinkSkewViolations,
} from '../packages/protocol/src/daemon-link-skew'

const DAEMON_PORT_PATH = 'packages/protocol/src/daemon-port.ts'

async function main(): Promise<void> {
  const baseRef = process.env.WIRE_SKEW_BASE || process.env.RENDER_CHECK_BASE
  if (baseRef === undefined || baseRef === '' || /^0+$/.test(baseRef)) {
    console.log('daemon link skew: no base ref, nothing to compare')
    return
  }
  await $`git cat-file -e ${baseRef}`
    .quiet()
    .nothrow()
    .then((present) =>
      present.exitCode === 0
        ? present
        : $`git fetch --no-tags --depth=1 origin ${baseRef}`.quiet().nothrow(),
    )
  const baseSource = await $`git show ${baseRef}:${DAEMON_PORT_PATH}`.quiet().nothrow()
  if (baseSource.exitCode !== 0) {
    console.log(
      `daemon link skew: ${DAEMON_PORT_PATH} is not readable at ${baseRef}, nothing to compare`,
    )
    return
  }
  const violations = daemonLinkSkewViolations({
    base: daemonLinkFactsOf(baseSource.stdout.toString()),
    head: daemonLinkFactsOf(await Bun.file(DAEMON_PORT_PATH).text()),
  })
  if (violations.length === 0) {
    console.log('daemon link skew: every daemon already in a pod can still read the frames')
    return
  }
  for (const violation of violations) console.error(`daemon link skew: ${violation}`)
  process.exit(1)
}

if (import.meta.main) await main()
