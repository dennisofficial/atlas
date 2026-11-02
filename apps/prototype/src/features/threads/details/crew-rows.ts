import type { AppTeammate } from '../../shell/fixtures/teammates'
import { teammateDisplay } from '../../shell/teammate-display'
import type { CrewRow } from './details-model'

export function teammateRowsOf(teammates: AppTeammate[]): CrewRow[] {
  return teammates.map((teammate) => ({
    id: teammate.id,
    title: teammate.title,
    display: teammateDisplay(teammate),
  }))
}
