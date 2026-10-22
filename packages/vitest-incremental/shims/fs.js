// Served in place of `node:fs` to repo modules (see ../fs-shim.js). Each tracked
// export looks the function up on the default object at call time, so it reaches
// the recorder's wrapper even on Bun, which ignores module.syncBuiltinESMExports().
import fs from 'node:fs'

export * from 'node:fs'
export default fs

export function readFileSync(...args) {
  return fs.readFileSync.apply(this, args)
}
export function openSync(...args) {
  return fs.openSync.apply(this, args)
}
export function readFile(...args) {
  return fs.readFile.apply(this, args)
}
export function open(...args) {
  return fs.open.apply(this, args)
}
export function createReadStream(...args) {
  return fs.createReadStream.apply(this, args)
}
export function readdirSync(...args) {
  return fs.readdirSync.apply(this, args)
}
export function opendirSync(...args) {
  return fs.opendirSync.apply(this, args)
}
export function readdir(...args) {
  return fs.readdir.apply(this, args)
}
export function opendir(...args) {
  return fs.opendir.apply(this, args)
}
export function existsSync(...args) {
  return fs.existsSync.apply(this, args)
}
export function accessSync(...args) {
  return fs.accessSync.apply(this, args)
}
export function exists(...args) {
  return fs.exists.apply(this, args)
}
export function access(...args) {
  return fs.access.apply(this, args)
}
export function statSync(...args) {
  return fs.statSync.apply(this, args)
}
export function stat(...args) {
  return fs.stat.apply(this, args)
}
export function lstatSync(...args) {
  return fs.lstatSync.apply(this, args)
}
export function lstat(...args) {
  return fs.lstat.apply(this, args)
}
export const promises = fs.promises
