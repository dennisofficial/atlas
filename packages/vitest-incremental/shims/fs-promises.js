// Served in place of `node:fs/promises` to repo modules (see ../fs-shim.js).
import fs from 'node:fs';

export * from 'node:fs/promises';
export default fs.promises;

export function readFile(...args) { return fs.promises.readFile.apply(this, args); }
export function open(...args) { return fs.promises.open.apply(this, args); }
export function readdir(...args) { return fs.promises.readdir.apply(this, args); }
export function opendir(...args) { return fs.promises.opendir.apply(this, args); }
export function access(...args) { return fs.promises.access.apply(this, args); }
export function stat(...args) { return fs.promises.stat.apply(this, args); }
export function lstat(...args) { return fs.promises.lstat.apply(this, args); }
