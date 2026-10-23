// Bun misreports a CJS require() that lands on an ESM entry still being fetched as
// "require() async module ... is unsupported" (https://github.com/oven-sh/bun/issues/33180,
// fix pending in https://github.com/oven-sh/bun/pull/37185). @nestjs/throttler is CJS and
// requires both packages from its module body, so they are settled here before any spec loads.
import '@nestjs/common'
import '@nestjs/core'
