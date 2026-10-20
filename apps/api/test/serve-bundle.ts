import { createServer } from 'node:http'

const bundlePath = process.argv[2]
if (!bundlePath) throw new Error('usage: serve-bundle.ts <path to the bundled index.js>')

const { default: handler } = await import(bundlePath)
const port = Number(process.env.PORT)

createServer(handler).listen(port, '0.0.0.0', () => {
  console.log(`bundle listening on ${port}`)
})
