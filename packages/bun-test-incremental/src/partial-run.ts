import { readFileSync } from 'node:fs'

export const PARTIAL_ENV = 'BUN_TEST_INCREMENTAL_PARTIAL'

const FILTER_FLAG = /^(-t|--test-name-pattern|--only)(=|$)|^-t./
const OFF = new Set(['0', 'false'])

export const hasFilterFlag = (args: readonly string[]) => args.some((arg) => FILTER_FLAG.test(arg))

function readCommandLine() {
  try {
    return readFileSync('/proc/self/cmdline', 'utf8').split('\0').filter(Boolean)
  } catch {
    return undefined
  }
}

export function isPartialRun(params: {
  env: NodeJS.ProcessEnv
  readCommandLine?: () => string[] | undefined
}) {
  const declared = params.env[PARTIAL_ENV]?.trim().toLowerCase()
  if (declared !== undefined && declared !== '') return !OFF.has(declared)
  const args = (params.readCommandLine ?? readCommandLine)()
  return args === undefined ? true : hasFilterFlag(args)
}
