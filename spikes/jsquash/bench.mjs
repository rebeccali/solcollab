// Sends each test image to the local Worker N times and summarizes timings + workerd RSS.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const URL_ = process.env.URL ?? 'http://127.0.0.1:8790/process';
const N = Number(process.env.N ?? 15);
const images = ['sparse', 'typical', 'noise_cap', 'noise_full'];
const pids = execSync("pgrep -f 'workerd serve' || true").toString().trim().split('\n').filter(Boolean);
const rss = () => pids.reduce((t, pid) => t + Number(execSync(`ps -o rss= -p ${pid} || echo 0`).toString().trim() || 0), 0) / 1024;
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

console.log(`workerd pids: ${pids.join(',')}  baseline RSS ${rss().toFixed(0)} MB`);
let peak = rss();
for (const name of images) {
  const body = readFileSync(`images/${name}.png`);
  await fetch(URL_, { method: 'POST', body }); // warm-up
  const totals = [], stages = {};
  let out;
  for (let i = 0; i < N; i++) {
    const res = await fetch(URL_, { method: 'POST', body });
    out = await res.json();
    if (out.error) throw new Error(`${name}: ${out.error}`);
    totals.push(out.totalMsPerf);
    for (const [k, v] of Object.entries(out.runs[0].marks)) (stages[k] ??= []).push(v);
    peak = Math.max(peak, rss());
  }
  const r = out.runs[0];
  console.log(`\n${name}.png  ${(body.length / 1024).toFixed(0)} KB in -> full ${(r.full / 1024).toFixed(0)} KB, thumb ${(r.thumb / 1024).toFixed(0)} KB`);
  console.log(`  total ms: median ${pct(totals, 50).toFixed(0)}  p95 ${pct(totals, 95).toFixed(0)}  max ${Math.max(...totals).toFixed(0)}`);
  console.log('  stages (median ms): ' + Object.entries(stages).map(([k, v]) => `${k} ${pct(v, 50).toFixed(0)}`).join(', '));
}
console.log(`\npeak workerd RSS during bench: ${peak.toFixed(0)} MB (whole runtime process, not just the isolate)`);
