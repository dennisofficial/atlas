# @dltech/atlas-schedule

Parses cron expressions and plain-English schedules, and computes the next run time in a named
timezone. The routines feature uses it in the web, in the API and in the Trigger.dev worker.

## Owns

- The cron parser and the `Cron` value type.
- The next-occurrence search in an IANA timezone, including daylight-saving changes.
- The parser of plain-English schedule text, such as "every weekday at 7am".
- The minimum gap between two runs of a schedule.

## Does not own

- The routine rows, their storage and their runs. `@dltech/atlas-control` owns them.
- The trigger.dev schedules. `apps/trigger` owns them.
- The display of a schedule in a surface. Each app owns its own.

## Entry points

| Import                   | Use it for                                                |
| ------------------------ | --------------------------------------------------------- |
| `@dltech/atlas-schedule` | The parsers, the next-run search and the gap measurement. |

## Capabilities

### Parse a schedule

- `parseCron(expression)`: returns `{ ok: true, cron }` or `{ ok: false, reason }` for a five-field
  cron expression.
- `parseScheduleText(text)`: returns `{ ok: true, cron }` or `{ ok: false, reason }` for phrases
  such as "every 15 minutes", "daily at 9am" or "on the 1st of the month".
- `ECronField`: the five cron fields, `Minute` to `DayOfWeek`.
- `CronFieldSyntaxError`: thrown by the field expander on a bad field.

### Find the next run

- `nextOccurrenceAfter({ cron, after, timezone })`: returns the first `Date` after `after`.
- `upcomingOccurrences({ cron, after, timezone, count })`: returns the next `count` dates.
- `CronNeverFiresError`: thrown when the search finds no occurrence, as with February 30.

### Measure a gap

- `minimumGapMinutes(cron)`: returns a lower bound, in minutes, from the minute field only. The
  gap is cyclic, so a schedule on the whole hour returns 60, even when it runs once a day.

## Usage

From `apps/trigger/src/trigger/routine/routine-cron.ts`:

```ts
import {
  CronNeverFiresError,
  type Cron,
  minimumGapMinutes,
  nextOccurrenceAfter,
  parseCron,
} from '@dltech/atlas-schedule'

export const cronOf = (expression: string): Cron => {
  const parsed = parseCron(expression)
  if (!parsed.ok) throw new Error(`routine cron "${expression}" does not parse: ${parsed.reason}`)
  return parsed.cron
}

export const nextOccurrenceFrom = (params: {
  cron: Cron
  timezone: string
  after: string
}): string =>
  nextOccurrenceAfter({
    cron: params.cron,
    timezone: params.timezone,
    after: new Date(params.after),
  }).toISOString()
```

## Rules

- Pass an IANA timezone name, such as `Europe/Berlin`. Do not pass an offset.
- Treat `ok: false` as a message for the operator. The `reason` text is ready to show.
- The package has no dependency. Do not add I/O or a clock to it.

## See also

- `docs/v2/slices/` documents the routines feature that uses this package.
