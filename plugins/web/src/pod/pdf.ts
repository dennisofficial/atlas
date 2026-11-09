export async function pdfToText(args: { bytes: Uint8Array; signal: AbortSignal }): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = pdfjs.getDocument({ data: args.bytes, useSystemFonts: true })
  const document = await task.promise

  try {
    const pages: string[] = []
    for (let number = 1; number <= document.numPages; number += 1) {
      if (args.signal.aborted) break
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      const prose = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replaceAll(/[ \t]+/g, ' ')
        .trim()
      pages.push(prose)
      page.cleanup()
    }
    return pages.join('\n\n')
  } finally {
    await task.destroy()
  }
}
