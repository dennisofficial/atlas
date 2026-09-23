const SPEC_GLOB = 'src/**/*.spec.{ts,tsx}'

const FILE_TIMEOUT_MS = 180_000

type Timing = {
  file: string
  seconds: number
  ok: boolean
}

async function specFiles(): Promise<string[]> {
  const found: string[] = []
  for await (const file of new Bun.Glob(SPEC_GLOB).scan({ cwd: `${import.meta.dir}/..` })) {
    found.push(file)
  }
  return found.sort()
}

async function timeFile(args: { file: string }): Promise<Timing> {
  const startedAt = Date.now()
  const child = Bun.spawn(['bun', 'test', args.file], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), FILE_TIMEOUT_MS)

  const [, , code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  clearTimeout(timer)

  return { file: args.file, seconds: (Date.now() - startedAt) / 1_000, ok: code === 0 }
}

async function main(): Promise<void> {
  const files = await specFiles()
  const total = files.length

  for (const [index, file] of files.entries()) {
    const timing = await timeFile({ file })
    process.stdout.write(`${JSON.stringify(timing)}\n`)
    process.stderr.write(`[${index + 1}/${total}] ${file} ${timing.seconds.toFixed(1)}s\n`)
  }
}

await main()
