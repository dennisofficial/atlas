export function splitCommandLine(line: string): { command: string; args: string[] } {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  let started = false
  for (const char of line.trim()) {
    if (quote !== null) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) tokens.push(current)
      current = ''
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) tokens.push(current)
  const [command = '', ...args] = tokens
  return { command, args }
}

const needsQuotes = (token: string): boolean => token === '' || /[\s"']/.test(token)

const quoteToken = (token: string): string => {
  if (!needsQuotes(token)) return token
  return token.includes('"') ? `'${token}'` : `"${token}"`
}

export function joinCommandLine({ command, args }: { command: string; args: readonly string[] }): string {
  return [command, ...args].map(quoteToken).join(' ')
}

export function parseKeyValueLines({
  text,
  separator,
}: {
  text: string
  separator: string
}): Record<string, string> {
  const entries: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const index = line.indexOf(separator)
    if (line === '' || line.startsWith('#') || index <= 0) continue
    entries[line.slice(0, index).trim()] = line.slice(index + separator.length).trim()
  }
  return entries
}
