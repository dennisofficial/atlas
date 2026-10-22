#!/usr/bin/env bun
import { PRELOAD_PATH } from '../index'
import { loadConfig } from './config'
import { ResultStore } from './store'
import { EMode } from './types'

const COMMANDS = new Map<string, EMode>([
  ['plan', EMode.Plan],
  ['force', EMode.Force],
  ['clear', EMode.Clear],
  ['run', EMode.Run],
])

const [command, ...testArgs] = process.argv.slice(2)
const mode = command === undefined ? undefined : COMMANDS.get(command)
if (mode === undefined) {
  console.error('usage: bun-test-incremental <plan|force|clear|run> [bun test args...]')
  process.exit(2)
}

const env = { ...process.env, BUN_TEST_INCREMENTAL: mode }
const config = loadConfig({ env, cwd: process.cwd() })
if (config && mode === EMode.Clear && testArgs.length === 0) {
  ResultStore.clear(config.cacheDir)
  console.log(`[incremental] cleared ${config.cacheDir}`)
  process.exit(0)
}

const child = Bun.spawnSync(['bun', 'test', '--preload', PRELOAD_PATH, ...testArgs], {
  env,
  stdio: ['inherit', 'inherit', 'inherit'],
})
process.exit(child.exitCode ?? 1)
