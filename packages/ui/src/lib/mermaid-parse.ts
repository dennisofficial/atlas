export async function parsesAsMermaid(source: string): Promise<boolean> {
  try {
    const { default: mermaid } = await import('mermaid')
    return (await mermaid.parse(source, { suppressErrors: true })) !== false
  } catch {
    return false
  }
}
