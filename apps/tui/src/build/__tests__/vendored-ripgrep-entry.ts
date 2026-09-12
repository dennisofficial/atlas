import { LocalProcessPort } from '@dltech/atlas-harness'

const port = new LocalProcessPort()
const path = (await port.vendored?.({ command: 'rg' })) ?? null

if (path === null) {
  console.log(JSON.stringify({ resolved: null }))
} else {
  const handle = port.spawn({ cmd: [path, '--version'], cwd: process.cwd() })
  const [stdout, exitCode] = await Promise.all([new Response(handle.stdout).text(), handle.exited])
  console.log(JSON.stringify({ resolved: path, firstLine: stdout.split('\n')[0], exitCode }))
}
