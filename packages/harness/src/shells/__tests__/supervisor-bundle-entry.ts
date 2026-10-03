import { z } from 'zod'

const argv = z.array(z.string()).parse(process.argv.slice(2))
console.log(`ok:${argv.join(',')}`)
