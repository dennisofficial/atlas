import { applyTranscriptArchive } from '../transcript-bootstrap'

export const explicitApply = async (args: Omit<Parameters<typeof applyTranscriptArchive>[0], 'explicit'>) => {
  const outcome = await applyTranscriptArchive({ ...args, explicit: true })
  return { restored: outcome.failed === null, failed: outcome.failed }
}
