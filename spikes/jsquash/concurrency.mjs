// Fires C concurrent noise_cap uploads at the local Worker; reports latency and workerd RSS.
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const C = Number(process.env.C ?? 10);
const body = readFileSync('images/noise_cap.png');
const pids = execSync("pgrep -f 'workerd serve'").toString().trim().split('\n');
const rss = () => pids.reduce((t, p) => t + Number(execSync(`ps -o rss= -p ${p}`).toString()), 0) / 1024;
let peak = rss(); const timer = setInterval(() => (peak = Math.max(peak, rss())), 20);
const t0 = performance.now();
const results = await Promise.all(Array.from({ length: C }, async () => {
  const s = performance.now(); const r = await fetch('http://127.0.0.1:8790/process', { method: 'POST', body });
  const j = await r.json(); return { ms: performance.now() - s, ok: !j.error, err: j.error };
}));
clearInterval(timer);
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
console.log(`C=${C}: all ok=${results.every((r) => r.ok)}  wall ${(performance.now() - t0).toFixed(0)} ms  latency min ${ms[0].toFixed(0)} / max ${ms.at(-1).toFixed(0)} ms  peak RSS ${peak.toFixed(0)} MB`);
