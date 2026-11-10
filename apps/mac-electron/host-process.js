import { spawn } from 'node:child_process'

import { sessionUrlIn } from './host-paths.js'

const START_TIMEOUT_MS = 20_000
const OUTPUT_LIMIT = 8_000

export function startHost({ script, bun, environment, timeoutMs = START_TIMEOUT_MS }) {
  const child = spawn(bun, [script], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  let settled = false
  const url = new Promise((resolve, reject) => {
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      fail(
        new Error(`the desktop host did not report a session URL within ${timeoutMs}ms\n${output}`),
      )
    }, timeoutMs)
    const collect = (chunk) => {
      output = (output + chunk.toString()).slice(-OUTPUT_LIMIT)
      const found = sessionUrlIn(output)
      if (found === undefined || settled) return
      settled = true
      clearTimeout(timer)
      resolve(found)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => fail(error))
    child.on('exit', (code) => fail(new Error(`the desktop host exited with ${code}\n${output}`)))
  })
  return { child, url, output: () => output }
}
