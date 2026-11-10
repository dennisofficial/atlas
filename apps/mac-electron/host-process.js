import { spawn } from 'node:child_process'

export const SESSION_MARKER = 'ATLAS_URL='
export const STARTUP_TIMEOUT_MS = 120_000

const OUTPUT_LIMIT = 8_000

export function parseSessionUrl(text) {
  for (const line of text.split('\n')) {
    if (line.startsWith(SESSION_MARKER)) return line.slice(SESSION_MARKER.length).trim()
  }
  return null
}

function spawnHostProcess({ command, args, cwd, env }) {
  return spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function bunCommand(env) {
  return env.ATLAS_BUN ?? 'bun'
}

export async function startDesktopHost({
  script,
  cwd,
  paneOrigin,
  env = process.env,
  spawnProcess = spawnHostProcess,
  timeoutMs = STARTUP_TIMEOUT_MS,
  log = () => {},
}) {
  const child = spawnProcess({
    command: bunCommand(env),
    args: [script],
    cwd,
    env: { ...env, ATLAS_PANE_ORIGIN: paneOrigin },
  })

  let output = ''
  const stop = () => {
    child.kill('SIGTERM')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const settle = (settler, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      settler(value)
    }

    const timer = setTimeout(() => {
      stop()
      settle(
        reject,
        new Error(`the desktop host did not print ${SESSION_MARKER} in ${timeoutMs}ms\n${output}`),
      )
    }, timeoutMs)

    const collect = (chunk) => {
      output = (output + String(chunk)).slice(-OUTPUT_LIMIT)
      log(String(chunk).trimEnd())
      const url = parseSessionUrl(output)
      if (url !== null) settle(resolve, { url, stop, output: () => output })
    }

    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('exit', (code) => {
      settle(
        reject,
        new Error(`the desktop host exited with code ${code} before it was ready\n${output}`),
      )
    })
  })
}
