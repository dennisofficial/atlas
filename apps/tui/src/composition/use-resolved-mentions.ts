import { useEffect, useMemo, useRef, useState } from 'react'

import { mentionedFilePaths, resolvedFileMentions, type FileMention } from '@dltech/atlas-core'
import type { MentionReader } from '@dltech/atlas-harness'

import { messageOf } from './error-text'

type Known = { reader: MentionReader | undefined; paths: ReadonlySet<string> }

const NOTHING_KNOWN: ReadonlySet<string> = new Set<string>()

export function useResolvedMentions(args: {
  text: string
  files?: MentionReader | undefined
  onProblem?: ((reason: string) => void) | undefined
}): readonly FileMention[] {
  const { files, text } = args
  const [held, setHeld] = useState<Known>({
    reader: files,
    paths: NOTHING_KNOWN,
  })
  const known = held.reader === files ? held.paths : NOTHING_KNOWN
  const reportProblem = useRef(args.onProblem)
  reportProblem.current = args.onProblem
  const failed = useRef<{
    reader: MentionReader | undefined
    paths: Set<string>
  }>({
    reader: files,
    paths: new Set<string>(),
  })

  useEffect(() => {
    setHeld((current) =>
      current.reader === files ? current : { reader: files, paths: NOTHING_KNOWN },
    )
    if (files === undefined) return

    if (failed.current.reader !== files)
      failed.current = { reader: files, paths: new Set<string>() }
    const gaveUp = failed.current.paths

    const paths = mentionedFilePaths(text).filter((path) => !known.has(path) && !gaveUp.has(path))
    if (paths.length === 0) return

    let live = true

    void Promise.all(
      paths.map(async (path) => {
        try {
          return { path, found: await files.exists(path), failure: null }
        } catch (error) {
          return { path, found: false, failure: messageOf(error) }
        }
      }),
    ).then((answers) => {
      if (!live) return

      const failures = answers.filter((answer) => answer.failure !== null)
      for (const answer of failures) gaveUp.add(answer.path)
      const first = failures[0]?.failure
      if (first !== undefined && first !== null) {
        reportProblem.current?.(`could not check mentioned files: ${first}`)
      }

      const found = answers.filter((answer) => answer.found).map((answer) => answer.path)
      if (found.length === 0) return

      setHeld((current) => {
        const base = current.reader === files ? current.paths : NOTHING_KNOWN
        const missing = found.filter((path) => !base.has(path))
        if (missing.length === 0 && current.reader === files) return current
        return { reader: files, paths: new Set([...base, ...missing]) }
      })
    })

    return () => {
      live = false
    }
  }, [files, known, text])

  return useMemo(() => resolvedFileMentions({ text, known }), [known, text])
}
