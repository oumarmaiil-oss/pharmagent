import fs from 'node:fs';
import { draftChecks } from '../../src/components/draftChecks.ts';
const drafts = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
const out: Record<string, unknown> = {};
for (const [name, d] of Object.entries(drafts)) out[name] = draftChecks(d as never);
console.log(JSON.stringify(out));
