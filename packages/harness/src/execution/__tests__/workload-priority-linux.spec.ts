import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

import { LocalProcessPort, type LocalProcessHandle } from '../local-process'
import { WORKLOAD_NICE } from '../workload-priority'

const OOM_PATH = '/proc/self/oom_score_adj'
const SERVE_LIKE_ADJ = '-900'

const readNumber = (path: string): number => Number(readFileSync(path, 'utf8').trim())

const canLowerOomScore = (): boolean => {
  if (process.platform !== 'linux') return false
  try {
    const current = readFileSync(OOM_PATH, 'utf8').trim()
    writeFileSync(OOM_PATH, SERVE_LIKE_ADJ)
    writeFileSync(OOM_PATH, current)
    return true
  } catch {
    return false
  }
}

const niceOf = (pid: number): number => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[16])
}

const textOf = async (stream: ReadableStream<Uint8Array>): Promise<string> =>
  await new Response(stream).text()

const awaitFirstChunk = async (handle: LocalProcessHandle): Promise<string> => {
  const reader = handle.stdout.getReader()
  const first = await reader.read()
  reader.releaseLock()
  return new TextDecoder().decode(first.value)
}

const describeInPod = canLowerOomScore() ? describe : describe.skip

describeInPod('workloads spawned through LocalProcessPort in a pod', () => {
  let ownAdj = ''
  const saved = {
    provisioned: process.env.ATLAS_API_PROVISIONED,
    pod: process.env.ATLAS_POD_NAME,
  }

  beforeEach(() => {
    ownAdj = readFileSync(OOM_PATH, 'utf8').trim()
    writeFileSync(OOM_PATH, SERVE_LIKE_ADJ)
    process.env.ATLAS_API_PROVISIONED = '1'
    delete process.env.ATLAS_POD_NAME
  })

  afterEach(() => {
    writeFileSync(OOM_PATH, ownAdj)
    if (saved.provisioned === undefined) delete process.env.ATLAS_API_PROVISIONED
    else process.env.ATLAS_API_PROVISIONED = saved.provisioned
    if (saved.pod !== undefined) process.env.ATLAS_POD_NAME = saved.pod
  })

  it('starts with a raised oom score and a lower priority than this process', async () => {
    const handle = new LocalProcessPort().spawn({
      cmd: ['bash', '-c', 'cat /proc/self/oom_score_adj; exec tail -f /dev/null'],
      cwd: tmpdir(),
    })
    try {
      expect(Number((await awaitFirstChunk(handle)).trim())).toBe(800)
      expect(readNumber(`/proc/${handle.pid}/oom_score_adj`)).toBe(800)
      expect(niceOf(handle.pid)).toBe(WORKLOAD_NICE)
    } finally {
      handle.terminate()
      await handle.exited
    }
  })

  it('ranks the workload above this process in the kernel oom_score', async () => {
    const handle = new LocalProcessPort().spawn({
      cmd: ['bash', '-c', 'echo up; exec tail -f /dev/null'],
      cwd: tmpdir(),
    })
    try {
      await awaitFirstChunk(handle)
      expect(readNumber(`/proc/${handle.pid}/oom_score`)).toBeGreaterThan(
        readNumber('/proc/self/oom_score'),
      )
    } finally {
      handle.terminate()
      await handle.exited
    }
  })

  it('demotes a detached launch too', async () => {
    const out = `${tmpdir()}/workload-priority-detached-${process.pid}.txt`
    await new LocalProcessPort().launchDetached({
      cmd: ['bash', '-c', `cat /proc/self/oom_score_adj > ${out}`],
      cwd: tmpdir(),
    })
    const deadline = Date.now() + 5_000
    let text = ''
    while (text === '' && Date.now() < deadline) {
      text = await Bun.file(out)
        .text()
        .catch(() => '')
      if (text === '') await Bun.sleep(25)
    }
    expect(text.trim()).toBe('800')
  })

  it('keeps stdout, stderr and the exit code of the wrapped command', async () => {
    const handle = new LocalProcessPort().spawn({
      cmd: ['bash', '-c', 'echo out; echo err >&2; exit 3'],
      cwd: tmpdir(),
    })
    const [stdout, stderr, code] = await Promise.all([
      textOf(handle.stdout),
      textOf(handle.stderr),
      handle.exited,
    ])
    expect({ stdout, stderr, code }).toEqual({
      stdout: 'out\n',
      stderr: 'err\n',
      code: 3,
    })
  })
})
