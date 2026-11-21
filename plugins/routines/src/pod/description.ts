export const ROUTINE_DESCRIPTION = [
  "Manage this project's routines; no other project is reachable.",
  'A routine runs a saved prompt on a cron, in a fresh session each time; it is not a reminder kept here.',
  'Read cron as five fields (minute, hour, day-of-month, month, weekday) in its IANA zone.',
  'The API rejects a cron more frequent than every 5 minutes, one it cannot parse or an unknown timezone.',
  '- list names each routine by id, cron, state and next run.',
  '- get reads one routine and its full prompt. Pass routineId.',
  '- create saves a routine here: pass name, prompt, cron, timezone. prompt is the whole instruction the agent gets at the start of a run, so write it to stand alone. model, effort and fast follow the project setting; enabled defaults to true.',
  '- update changes the fields passed beside routineId. enabled false pauses a routine; enabled true resumes it and recomputes the next run. A null model, effort or fast follows the project default.',
  '- delete removes a routine for good and drops it from the Routines page in the Atlas web app. Its past sessions stay. To pause instead, use update.',
  '- run starts a routine now, off its schedule, in its own full session, named in the reply. You do not see its turn; the schedule stays.',
].join(' ')
