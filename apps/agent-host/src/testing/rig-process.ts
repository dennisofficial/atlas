const LISTENING = /listening on (\d+) bootId=(\S+)/

export const waitForListening = async (
  child: Bun.Subprocess<'ignore', 'pipe', 'pipe'>,
): Promise<{ port: number; bootId: string }> => {
  const reader = child.stdout.getReader()
  const decoder = new TextDecoder()
  let seen = ''
  const deadline = setTimeout(() => void reader.cancel(), 10_000)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      seen += decoder.decode(value, { stream: true })
      const match = LISTENING.exec(seen)
      if (match?.[1] !== undefined && match[2] !== undefined) {
        return { port: Number(match[1]), bootId: match[2] }
      }
    }
  } finally {
    clearTimeout(deadline)
    reader.releaseLock()
  }
  const stderr = await new Response(child.stderr).text()
  throw new Error(`daemon did not start: ${seen}${stderr}`)
}

export const collectLines = (stream: ReadableStream<Uint8Array>, into: string[]): void => {
  void (async () => {
    const decoder = new TextDecoder()
    let rest = ''
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      rest += decoder.decode(chunk, { stream: true })
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) if (line !== '') into.push(line)
    }
  })()
}
