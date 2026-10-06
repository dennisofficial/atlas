import { ERunMode } from './results'

export class ArgParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArgParseError'
  }
}

export type ParsedArgs = {
  flags: Readonly<Record<string, true>>
  values: Readonly<Record<string, string>>
  lists: Readonly<Record<string, readonly string[]>>
}

const listKeys = new Set(['--session-dir'])

export function parseArgs({ argv, spec }: { argv: readonly string[]; spec: Record<string, 'flag' | 'value'> }): ParsedArgs {
  const flags: Record<string, true> = {}
  const values: Record<string, string> = {}
  const lists: Record<string, string[]> = {}
  let index = 0
  while (index < argv.length) {
    const arg = argv[index] as string
    const kind = spec[arg]
    if (kind === undefined) throw new ArgParseError(`unknown argument "${arg}"`)
    if (kind === 'flag') {
      flags[arg] = true
      index += 1
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) throw new ArgParseError(`argument "${arg}" needs a value`)
    if (listKeys.has(arg)) {
      const existing = lists[arg] ?? []
      existing.push(value)
      lists[arg] = existing
    } else {
      if (arg in values) throw new ArgParseError(`argument "${arg}" given twice`)
      values[arg] = value
    }
    index += 2
  }
  return { flags, values, lists }
}

export function requireValue({ args, key }: { args: ParsedArgs; key: string }): string {
  const value = args.values[key]
  if (value === undefined) throw new ArgParseError(`missing required ${key}`)
  return value
}

export function parseTrials({ args }: { args: ParsedArgs }): number {
  const raw = args.values['--trials']
  if (raw === undefined) return 1
  const trials = Number(raw)
  if (!Number.isInteger(trials) || trials < 1) throw new ArgParseError(`--trials must be a positive integer, got "${raw}"`)
  return trials
}

export function resolveRunMode({ args, env }: { args: ParsedArgs; env: Record<string, string | undefined> }): ERunMode {
  if (args.flags['--live'] === true && args.flags['--fake'] === true) {
    throw new ArgParseError('--fake and --live are mutually exclusive')
  }
  if (args.flags['--live'] === true) {
    if (env.ATLAS_EVAL_LIVE !== '1') {
      throw new ArgParseError('--live additionally requires ATLAS_EVAL_LIVE=1 in the environment')
    }
    return ERunMode.Live
  }
  return ERunMode.Fake
}

export function resolveModel({ args, defaultModel }: { args: ParsedArgs; defaultModel: string }): { requested: string; promotable: boolean } {
  const override = args.values['--model']
  if (override === undefined) return { requested: defaultModel, promotable: true }
  return { requested: override, promotable: override === defaultModel }
}
