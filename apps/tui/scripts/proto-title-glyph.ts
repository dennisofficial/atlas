#!/usr/bin/env bun
/**
 * PROTOTYPE (throwaway): tab-title state glyph, as the terminal sidebar sees it.
 *
 * Run in its own tile:  bun apps/tui/scripts/proto-title-glyph.ts
 *   Every <cycle-seconds> the script cycles the working glyph for a while, then settles back
 *   to idle — watch this tile's entry in the terminal's tab/sidebar list, not the tile body.
 *
 * Flags:
 *   --idle <glyph>    idle glyph (default: ◦)
 *   --frames <list>   comma-separated working frames (default: 🌑,🌒,🌓,🌔,🌕,🌖,🌗,🌘)
 *   --frame-ms <ms>   working frame cadence (default: 240)
 *   --working <s>     seconds each working burst lasts (default: 6)
 *   --cycle <s>       seconds between burst starts (default: 12)
 *   --names <list>    comma-separated titles to rotate through per burst
 */
import { terminalTitleSequence } from '../src/composition/terminal-title'
import { IDLE_TITLE_GLYPH, WORKING_TITLE_FRAME_MS, WORKING_TITLE_FRAMES } from '../src/ui/glyphs'

const flag = <T>(name: string, fallback: T, parse: (raw: string) => T): T => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const raw = process.argv[index + 1]
  return raw === undefined ? fallback : parse(raw)
}

const idleGlyph = flag('idle', IDLE_TITLE_GLYPH, (raw) => raw)
const frames = flag('frames', [...WORKING_TITLE_FRAMES], (raw) => raw.split(','))
const frameMs = flag('frame-ms', WORKING_TITLE_FRAME_MS, Number)
const workingSeconds = flag('working', 6, Number)
const cycleSeconds = flag('cycle', 12, Number)
const names = flag(
  'names',
  ['Review PR 611', 'Atlas sandbox state transitions', 'Sign commit and configure'],
  (raw) => raw.split(','),
)

const directory = process.cwd()

const write = (glyph: string, name: string): void => {
  process.stdout.write(terminalTitleSequence({ name, directory, glyph }))
}

let burst = 0
let frame = 0

const runBurst = (): void => {
  const name = names[burst % names.length] ?? 'atlas'
  const startedAt = Date.now()
  const spinner = setInterval(() => {
    process.stdout.write(`\rworking ${frames[frame % frames.length]}  (burst ${burst + 1}, ${name})  `)
    write(frames[frame % frames.length] ?? '🌑', name)
    frame += 1
    if (Date.now() - startedAt >= workingSeconds * 1000) {
      clearInterval(spinner)
      write(idleGlyph, name)
      process.stdout.write(`\nidle ${idleGlyph} — next burst in ${cycleSeconds - workingSeconds}s\n`)
    }
  }, frameMs)
}

write(idleGlyph, names[0] ?? 'atlas')
process.stdout.write(
  `title-glyph proto: watch this tile in your terminal's tab/sidebar list.\n` +
    `idle=${idleGlyph} frames=${frames.join('')} every ${frameMs}ms, ` +
    `${workingSeconds}s working bursts every ${cycleSeconds}s. ctrl+c to stop.\n\n`,
)
runBurst()
burst += 1
setInterval(() => {
  runBurst()
  burst += 1
}, cycleSeconds * 1000)
