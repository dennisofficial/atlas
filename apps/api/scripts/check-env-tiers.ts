import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lineFaultsOf } from './env-tier-lines'

const ENVS = join(import.meta.dirname, '..', 'envs')

const tiers = readdirSync(ENVS).filter((name) => name.endsWith('.enc'))
const faults = tiers.flatMap((name) =>
  lineFaultsOf(readFileSync(join(ENVS, name), 'utf8')).map(
    (fault) =>
      `apps/api/envs/${name}:${fault.line} ${fault.fault}${fault.key ? ` ${fault.key}` : ''}`,
  ),
)

if (faults.length > 0) {
  console.error('env tier files must hold only comments, blanks and encrypted assignments:')
  for (const fault of faults) console.error(`  ${fault}`)
  console.error('fix: dotenvx set KEY "value" -f <file>  (quote multi-line values)')
  process.exit(1)
}
