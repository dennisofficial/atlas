#!/usr/bin/env bun
/**
 * PROTOTYPE (throwaway): tab-title state glyph, as the terminal sidebar sees it.
 *
 * Run in its own tile:  bun apps/tui/scripts/proto-title-glyph.ts
 *   Every <cycle-seconds> the script cycles the working glyph for a while, then settles back
 *   to idle — watch this tile's entry in the terminal's tab/sidebar list, not the tile body.
 *
 * Flags:
 *   --preset <name>   grayscale working-frame set: moon | circle | arc | quarter | shade |
 *                     orbit | braille (default: moon)
 *   --idle <glyph>    idle glyph (default: ◦)
 *   --needs <glyph>   needs-you glyph, held between bursts (default: ●)
 *   --needs <s>       seconds the needs-you state holds between bursts (default: 4)
 *   --frames <list>   comma-separated working frames (overrides the preset)
 *   --frame-ms <ms>   working frame cadence (default: 240)
 *   --working <s>     seconds each working burst lasts (default: 6)
 *   --cycle <s>       seconds between burst starts (default: 16)
 *   --names <list>    comma-separated titles to rotate through per burst
 */
import { terminalTitleSequence } from '../src/composition/terminal-title'
import { IDLE_TITLE_GLYPH, WORKING_TITLE_FRAME_MS, WORKING_TITLE_FRAMES } from '../src/ui/glyphs'

const PRESETS: Record<string, readonly string[]> = {
  moon: WORKING_TITLE_FRAMES,
  circle: ['◔', '◑', '◕', '●'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  quarter: ['◴', '◷', '◶', '◵'],
  shade: ['░', '▒', '▓', '█', '▓', '▒'],
  orbit: ['∙', '•', '●', '•'],
  braille: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
}

const flag = <T>(name: string, fallback: T, parse: (raw: string) => T): T => {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const raw = process.argv[index + 1]
  return raw === undefined ? fallback : parse(raw)
}

const preset = flag('preset', 'moon', (raw) => raw)
const presetFrames = PRESETS[preset]
if (presetFrames === undefined) {
  process.stderr.write(`unknown preset "${preset}" — one of: ${Object.keys(PRESETS).join(', ')}\n`)
  process.exit(64)
}
const idleGlyph = flag('idle', IDLE_TITLE_GLYPH, (raw) => raw)
const needsGlyph = flag('needs', '●', (raw) => raw)
const needsSeconds = flag('needs-hold', 4, Number)
const frames = flag('frames', [...presetFrames], (raw) => raw.split(','))
const frameMs = flag('frame-ms', WORKING_TITLE_FRAME_MS, Number)
const workingSeconds = flag('working', 6, Number)
const cycleSeconds = flag('cycle', 16, Number)
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

const holdNeedsYou = (name: string, done: () => void): void => {
  write(needsGlyph, name)
  process.stdout.write(`\nneeds you ${needsGlyph} for ${needsSeconds}s —`)
  setTimeout(done, needsSeconds * 1000)
}

const runBurst = (): void => {
  const name = names[burst % names.length] ?? 'atlas'
  const startedAt = Date.now()
  const spinner = setInterval(() => {
    process.stdout.write(`\rworking ${frames[frame % frames.length]}  (burst ${burst + 1}, ${name})  `)
    write(frames[frame % frames.length] ?? '🌑', name)
    frame += 1
    if (Date.now() - startedAt >= workingSeconds * 1000) {
      clearInterval(spinner)
      holdNeedsYou(name, () => {
        write(idleGlyph, name)
        process.stdout.write(` idle ${idleGlyph} — next burst in ${Math.max(0, cycleSeconds - workingSeconds - needsSeconds)}s\n`)
      })
    }
  }, frameMs)
}

write(idleGlyph, names[0] ?? 'atlas')
process.stdout.write(
  `title-glyph proto: watch this tile in your terminal's tab/sidebar list.\n` +
    `idle=${idleGlyph} needs-you=${needsGlyph} (${needsSeconds}s) frames=${frames.join('')} every ${frameMs}ms, ` +
    `${workingSeconds}s working bursts every ${cycleSeconds}s. ctrl+c to stop.\n\n`,
)
runBurst()
burst += 1
setInterval(() => {
  runBurst()
  burst += 1
}, cycleSeconds * 1000)
