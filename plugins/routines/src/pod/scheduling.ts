export const SCHEDULING: readonly string[] = [
  'A routine schedules a saved prompt to run on a cron in a fresh session each run.',
  'It is not a reminder kept in this session.',
  'Read cron as five fields: minute, hour, day-of-month, month and weekday.',
  "The routine's IANA timezone determines the time.",
  'For example, `0 9 * * 1-5` is 09:00 on weekdays.',
  'The API rejects a cron that runs more often than every 5 minutes.',
  'It also rejects a cron it cannot parse or an unknown timezone.',
  'Find routines on the Routines page in the Atlas web app.',
]
