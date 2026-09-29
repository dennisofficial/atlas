import { randomUUID } from 'node:crypto'

/**
 * The identity of this harness process, minted once at module load. Every shell event this process
 * appends carries it, so a background shell's start and end pair only when they belong to the same
 * boot: a recycled shellId under a new process can never settle a start that outlived a previous one.
 */
export const bootId = randomUUID()
