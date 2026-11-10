#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fit, planText } from './palette_fit.mjs';

const args = process.argv.slice(2);
const [model, spools] = args.filter((a) => a !== '--json');
if (!model || !spools) { console.error('usage: node cli.mjs model.3mf spools.txt [--json]'); process.exit(2); }
const result = await fit(readFileSync(model), readFileSync(spools, 'utf8')).catch((e) => { console.error(`${model}: ${e.message}`); process.exit(1); });
console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : planText(result));
