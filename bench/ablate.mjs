#!/usr/bin/env node
// Phase 6: the pillar-course cruise under each ablation, collisions + drift per condition.
//   scripts/gpu-box.sh runx "node bench/ablate.mjs [--readout dna02] [--seconds 20] [--conditions all]"
// Conditions (GOAL.md): bridge off (the null); recurrent transmission in [B] off; central brain
// silenced (only optic lobe + VNC live); haltere feedback off; neck connective cut (descending
// neurons silenced); plus the intact loop and, for reference, a decapitated fly (whole brain
// silenced) to ask whether the VNC holds a rhythm on its own.
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './lib/graph.mjs';
import { launchCombinedBrowser, launchSoftwareBrowser, startVite } from './lib/browser.mjs';
import { openLoop, cruise, fmt } from './lib/cruise.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GL = arg('gl', 'combined'), READOUT = arg('readout', 'dng02'), BACKEND = arg('backend', 'gpu'), SECONDS = Number(arg('seconds', 20)), DNBIAS = Number(arg('dnbias', 0.4)), TURNGAIN = Number(arg('turngain', 2)), ONLY = arg('conditions', 'all'), HSIGN = Number(arg('halteresign', -1)), RECORD = process.argv.includes('--record'), GATE = Number(arg('gate', 0)), RECENTER = Number(arg('recenter', 0)), TAG = arg('tag', '');
const BRAIN = ['cb_intrinsic', 'cb_sensory', 'cb_motor', 'cb_endocrine', 'cb_efferent', 'cb_sensory_tbc', 'ol_intrinsic', 'ol_sensory', 'visual_projection', 'visual_centrifugal', 'visual_projection_tbc', 'descending_neuron', 'descending_neuron_tbc', 'sensory_descending', 'efferent_descending'];
const CENTRAL = ['cb_intrinsic', 'cb_sensory', 'cb_motor', 'cb_endocrine', 'cb_efferent', 'cb_sensory_tbc'];
const CONDITIONS = {
  intact: { haltere: true, bridge: true },
  'bridge-off': { haltere: true, bridge: false },
  'recurrence-off': { haltere: true, bridge: true, before: () => { window.__loop.silenced = true; } },
  'central-brain-silenced': { haltere: true, bridge: true, before: (sc) => { window.__loop.mute(sc, 50); }, arg: CENTRAL },
  'haltere-off': { haltere: false, bridge: true },
  'neck-cut': { haltere: true, bridge: true, before: (sc) => { window.__loop.mute(sc, 50); }, arg: ['descending_neuron', 'descending_neuron_tbc', 'sensory_descending', 'efferent_descending'] },
  decapitated: { haltere: true, bridge: true, before: (sc) => { window.__loop.mute(sc, 50); }, arg: BRAIN },
};
const names = ONLY === 'all' ? Object.keys(CONDITIONS) : ONLY.split(',');
const vite = await startVite();
const browser = GL === 'software' ? await launchSoftwareBrowser() : await launchCombinedBrowser();
const report = { readout: READOUT, seconds: SECONDS, dnBias: DNBIAS, turnGain: TURNGAIN, haltereSign: HSIGN, gate: GATE, recenterTau: RECENTER, conditions: {} };
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.log('   pageerror: ' + e.message));
  for (const name of names) {
    const c = CONDITIONS[name];
    const boot = await openLoop(page, vite.url, { readout: READOUT, backend: BACKEND, dnBias: DNBIAS, turnGain: TURNGAIN, haltere: c.haltere, haltereSign: HSIGN, course: true, bridge: c.bridge, gate: GATE, recenter: RECENTER });
    console.log(`\n== ${name}: ${boot.backend}, ${boot.config?.pairs} bridge cells (${c.bridge ? 'on' : 'off'}), haltere ${c.haltere ? 'on' : 'off'}`);
    let before = null;
    if (c.before) before = c.arg ? `(${c.before.toString()})(${JSON.stringify(c.arg)})` : `(${c.before.toString()})()`;
    const record = RECORD && name === 'intact' ? join(ROOT, `docs/cruise-intact-${READOUT}${TAG}.webm`) : null;
    const r = await cruise(page, { seconds: SECONDS, baseAmp: 0.7, before, record });
    if (record) console.log('   recorded ' + record);
    const muted = await page.evaluate(() => window.__loop.muted?.count ?? 0);
    r.muted = muted;
    report.conditions[name] = r;
    console.log(`   ${fmt(r)}${muted ? `; ${muted} neurons muted` : ''}`);
    await page.evaluate(() => window.__loop.reset());
  }
} finally {
  await browser.close().catch(() => {});
  vite.stop();
}
mkdirSync(join(ROOT, 'bench/out'), { recursive: true });
writeFileSync(join(ROOT, `bench/out/ablate-${READOUT}${TAG}.json`), JSON.stringify(report, null, 1));
console.log(`wrote bench/out/ablate-${READOUT}${TAG}.json`);
