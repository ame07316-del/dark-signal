// Read stdin only: never put the actual secret in source code, CLI arguments or chat.
import {readFileSync}from'node:fs';import{createHash}from'node:crypto';
const value=readFileSync(0,'utf8').replace(/\r?\n$/,'');
if(!value||Buffer.byteLength(value)>128){console.error('Provide 1–128 UTF-8 bytes on stdin.');process.exitCode=1;}
else console.log(createHash('sha256').update(value).digest('hex'));
