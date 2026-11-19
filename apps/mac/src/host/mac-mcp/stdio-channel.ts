import { homedir } from 'node:os'

import {
  jsonRpcMessageSchema,
  type JsonRpcMessage,
  type MacServerTransport,
} from '@dltech/atlas-protocol/mac-link'

import { errnoReason, withStderrTail, type MacMcpChannel, type MacMcpChannelArgs } from './channel'

export const STDERR_LINES = 50

export const LINE_BYTES = 1_048_576

export const KILL_GRACE_MS = 2_000

const createTail = (limit: number) => {
  let lines: string[] = []
  return {
    push: (line: string): void => {
      lines = [...lines, line].slice(-limit)
    },
    lines: (): readonly string[] => lines,
  }
}

export const openStdioChannel = async (
  args: MacMcpChannelArgs & {
    transport: Extract<MacServerTransport, { kind: 'stdio' }>
    spawn: typeof Bun.spawn
    path: () => Promise<string>
    cwd?: string
  },
): Promise<MacMcpChannel> => {
  const name = args.transport.command
  const stderrTail = createTail(STDERR_LINES)
  const child = args.spawn({
    cmd: [args.transport.command, ...(args.transport.args ?? [])],
    cwd: args.cwd ?? homedir(),
    env: { ...process.env, PATH: await args.path(), ...args.transport.env },
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let closed = false
  let closing: string | undefined
  let used = args.now()
  let queue: Promise<void> = Promise.resolve()

  const finish = (reason: string): void => {
    if (closed) return
    closed = true
    args.emit({
      type: 'closed',
      channelId: args.channelId,
      reason: withStderrTail(reason, stderrTail.lines()),
    })
  }

  const handleLine = (line: string): void => {
    if (line.trim() === '') return
    if (line.length > LINE_BYTES) {
      args.log(`${name}: dropped a line over ${LINE_BYTES} bytes`)
      return
    }
    const message = jsonRpcMessageSchema.safeParse(parseJson(line))
    if (!message.success) {
      args.log(`${name}: dropped stdout that is not a JSON-RPC message`)
      return
    }
    used = args.now()
    args.emit({ type: 'rpc', channelId: args.channelId, message: message.data })
  }

  const readLines = async (
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void,
  ): Promise<void> => {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of stream) {
      buffer += decoder.decode(chunk, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      for (const line of parts) onLine(line)
      if (buffer.length > LINE_BYTES) {
        args.log(`${name}: dropped a line over ${LINE_BYTES} bytes`)
        buffer = ''
      }
    }
    if (buffer !== '') onLine(buffer)
  }

  const recordStderr = (line: string): void => {
    const text = line.trimEnd()
    if (text === '') return
    stderrTail.push(text)
    args.log(`${name}: ${text}`)
  }

  const stdout =
    child.stdout === undefined
      ? Promise.resolve()
      : readLines(child.stdout, handleLine).catch((error: unknown) => {
          args.log(`${name}: stdout reader failed: ${errnoReason(error)}`)
        })
  const stderr =
    child.stderr === undefined
      ? Promise.resolve()
      : readLines(child.stderr, recordStderr).catch((error: unknown) => {
          args.log(`${name}: stderr reader failed: ${errnoReason(error)}`)
        })

  void child.exited.then(async (code) => {
    await Promise.all([stdout, stderr])
    finish(closing ?? `exit ${code}`)
  })

  const send = (message: JsonRpcMessage): void => {
    if (closed) return
    used = args.now()
    queue = queue.then(async () => {
      if (closed) return
      try {
        child.stdin.write(`${JSON.stringify(message)}\n`)
        await child.stdin.flush()
      } catch (error) {
        finish(`stdin closed: ${errnoReason(error)}`)
      }
    })
  }

  const close = (reason: string): void => {
    if (closed) return
    closing ??= reason
    child.kill('SIGTERM')
    void (async () => {
      const died = await Promise.race([
        child.exited.then(() => true),
        Bun.sleep(KILL_GRACE_MS).then(() => false),
      ])
      if (!died) child.kill('SIGKILL')
      await Promise.all([stdout, stderr])
      finish(closing ?? reason)
    })()
  }

  return { send, close, lastUsedAt: () => used }
}

const parseJson = (line: string): unknown => {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
