import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { lineFaultsOf } from './env-tier-lines'

const REPO = join(import.meta.dirname, '..', '..', '..')
const ENV_DIRS = ['apps/api/envs', 'apps/agent-host', 'apps/trigger/envs']

const faults = ENV_DIRS.flatMap((dir) =>
  readdirSync(join(REPO, dir))
    .filter((name) => name.endsWith('.enc'))
    .flatMap((name) =>
      lineFaultsOf(readFileSync(join(REPO, dir, name), 'utf8')).map(
        (fault) => `${dir}/${name}:${fault.line} ${fault.fault}${fault.key ? ` ${fault.key}` : ''}`,
      ),
    ),
)

if (faults.length > 0) {
  console.error('env tier files must hold only comments, blanks and encrypted assignments:')
  for (const fault of faults) console.error(`  ${fault}`)
  console.error('fix: dotenvx set KEY "value" -f <file>  (quote multi-line values)')
  process.exit(1)
}
