export const SCHEDULING: readonly string[] = [
  'A routine schedules a saved prompt to run on a cron in a fresh session each run; it is not a reminder kept in this conversation.',
  'cron is five fields — minute hour day-of-month month weekday — read in the routine\'s IANA timezone, so "0 9 * * 1-5" is 09:00 on weekdays.',
  'The API rejects a cron that would run more often than every 5 minutes, a cron it cannot parse, and an unknown timezone.',
  'Routines are listed on the Routines page in the Atlas web app.',
]
