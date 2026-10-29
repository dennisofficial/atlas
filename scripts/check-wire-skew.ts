import { $ } from 'bun'

import { skewViolations, wireFactsOf } from '../packages/wire/src/wire-skew'

const WIRE_PATH = 'packages/wire/src/channel-wire.ts'

async function main(): Promise<void> {
  const baseRef = process.env.WIRE_SKEW_BASE
  if (baseRef === undefined || baseRef === '') {
    console.log('wire skew: no base ref, nothing to compare')
    return
  }
  const baseSource = await $`git show ${baseRef}:${WIRE_PATH}`.quiet().nothrow()
  if (baseSource.exitCode !== 0) {
    console.log(`wire skew: ${WIRE_PATH} is not readable at ${baseRef}, nothing to compare`)
    return
  }
  const violations = skewViolations({
    base: wireFactsOf(baseSource.stdout.toString()),
    head: wireFactsOf(await Bun.file(WIRE_PATH).text()),
  })
  if (violations.length === 0) {
    console.log('wire skew: the change keeps every released serve reachable')
    return
  }
  for (const violation of violations) console.error(`wire skew: ${violation}`)
  process.exit(1)
}

if (import.meta.main) await main()
