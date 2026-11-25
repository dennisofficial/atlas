import { Sandbox } from '@vercel/sandbox'

const name = process.argv[2]
if (!name) throw new Error('usage: bun stop.ts <sandbox-name>')
const sandbox = await Sandbox.get({
  token: process.env.VERCEL_TOKEN!,
  teamId: 'team_GR4aCzLIY5D3YYWgITz3Tere',
  projectId: 'prj_2WZtbG1HZHkgHCYiCTxVp4lfRZ47',
  name,
})
await sandbox.stop()
console.log(`stopped ${name} (status now: ${sandbox.status})`)
