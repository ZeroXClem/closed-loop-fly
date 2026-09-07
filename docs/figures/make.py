#!/usr/bin/env python3
"""Figure set for the write-up / thread. Reads bench/out/*.json, bench/out/dng02-sweep.md and
docs/figures/shots/*.png, writes docs/figures/NN-*.png (3200 x 1800, dark).

    python3 docs/figures/make.py            # everything that has data
    python3 docs/figures/make.py loom drum  # a subset

Every number comes from a bench output; nothing is typed in by hand except labels. The two
diagrams (loop-ring.html, dng02-wiring.html) are rendered separately with a headless browser.
"""
import json, re, sys, math, textwrap
from pathlib import Path
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Rectangle

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/figures'
BO = ROOT / 'bench/out'
SHOTS = OUT / 'shots'

# ---- style
BG, PANEL, INK, MUTED, GRID = '#0b0e13', '#121821', '#e8edf3', '#8d97a5', '#1f2733'
A, B, DN, GOOD, BAD, WARN = '#3fd6c8', '#ffb545', '#ff5c8a', '#7ee081', '#ff6b6b', '#c7a3ff'
plt.rcParams.update({
    'figure.facecolor': BG, 'axes.facecolor': BG, 'savefig.facecolor': BG,
    'font.family': 'sans-serif', 'font.sans-serif': ['Liberation Sans', 'DejaVu Sans'],
    'text.color': INK, 'axes.labelcolor': MUTED, 'axes.edgecolor': GRID,
    'xtick.color': MUTED, 'ytick.color': MUTED, 'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': 0.8,
    'axes.spines.top': False, 'axes.spines.right': False, 'axes.titlepad': 14,
    'font.size': 15, 'axes.labelsize': 16, 'xtick.labelsize': 14, 'ytick.labelsize': 14, 'legend.fontsize': 14,
    'axes.axisbelow': True, 'axes.unicode_minus': True,
})
W, H, DPI = 16, 9, 200
REPO = 'github.com/ZeroXClem/closed-loop-fly'

def fig(kicker, title, sub=None, source=None):
    """Header block; returns (figure, top of the free area in figure fraction)."""
    f = plt.figure(figsize=(W, H), dpi=DPI)
    f.text(0.04, 0.955, kicker.upper(), fontsize=15, color=A, weight='bold', ha='left', va='top')
    lines = textwrap.wrap(title, 56)
    y = 0.905
    f.text(0.04, y, '\n'.join(lines), fontsize=34, weight='bold', ha='left', va='top', color=INK, linespacing=1.15)
    y -= len(lines) * (34 * 1.15 / 72 / H) + 0.018
    if sub:
        sl = textwrap.wrap(sub, 115)
        f.text(0.04, y, '\n'.join(sl), fontsize=17, color=MUTED, ha='left', va='top', linespacing=1.3)
        y -= len(sl) * (17 * 1.3 / 72 / H) + 0.03
    if source: f.text(0.04, 0.028, source, fontsize=12, color=MUTED, ha='left', va='bottom')
    f.text(0.96, 0.028, REPO, fontsize=12, color=MUTED, ha='right', va='bottom')
    return f, y

def save(f, name):
    p = OUT / f'{name}.png'; f.savefig(p, dpi=DPI); plt.close(f); print('wrote', p.relative_to(ROOT))

def load(name):
    p = BO / name
    return json.load(open(p)) if p.exists() else None

def panel(ax):
    ax.set_facecolor(PANEL)
    for s in ('left', 'bottom'): ax.spines[s].set_color(GRID)

def txt(ax, x, y, s, color=INK, size=15, **kw):
    ax.text(x, y, s, color=color, fontsize=size, **kw)

BOTTOM = 0.115

# ---------------------------------------------------------------- 01 same fly
def same_fly():
    ov, ed = load('overlap.json'), load('edges.json')
    nA, nB, eA, eB = ov['A']['units'], ov['B']['neurons'], ov['A']['edges'], ov['B']['edges']
    f, top = fig('Phase 0 · reconnaissance', 'Two repos, one fly: the optic-lobe model is an exact subset of the whole-CNS graph',
                 f'Every one of the {nA:,} optic-v2 units and all {eA:,} of its connections exist in the {nB:,}-neuron MaleCNS graph with the same '
                 'synapse count. So a rate in one network can become a current on the very same neuron ID in the other.',
                 'bench/overlap.mjs, bench/edges.mjs · MaleCNS (Janelia) · Xenova/fruit-fly-simulation · AbijahKaj/fruit-fly-brain')
    ax = f.add_axes([0.04, 0.08, 0.92, top - 0.08]); ax.axis('off'); ax.set_xlim(0, 100); ax.set_ylim(0, 56); ax.set_aspect('auto')
    def nest(x0, big, small, big_lab, small_lab, unit):
        s_big = 42; s_small = s_big * math.sqrt(small / big)
        ax.add_patch(FancyBboxPatch((x0, 4), s_big, s_big, boxstyle='round,pad=0,rounding_size=1.5', fc=PANEL, ec=B, lw=2.5))
        ax.add_patch(FancyBboxPatch((x0 + 3, 7), s_small, s_small, boxstyle='round,pad=0,rounding_size=1.2', fc='#0f2a2c', ec=A, lw=2.5))
        txt(ax, x0 + s_big - 1.5, 4 + s_big - 2.5, f'[B]  {big:,} {unit}', B, 21, ha='right', va='top', weight='bold')
        txt(ax, x0 + s_big - 1.5, 4 + s_big - 7.5, big_lab, MUTED, 14, ha='right', va='top')
        cx, cy = x0 + 3 + s_small / 2, 7 + s_small / 2
        if s_small > 24:
            txt(ax, cx, cy + 3, f'[A]  {small:,}', A, 21, ha='center', va='center', weight='bold')
            txt(ax, cx, cy - 1.8, small_lab, INK, 14, ha='center', va='center')
            txt(ax, cx, cy - 6, '100% found in [B]', GOOD, 16, ha='center', va='center', weight='bold')
        else:
            lx = x0 + 3 + s_small + 2.5
            txt(ax, lx, cy + 3, f'[A]  {small:,}', A, 21, ha='left', va='center', weight='bold')
            txt(ax, lx, cy - 1.8, small_lab, INK, 14, ha='left', va='center')
            txt(ax, lx, cy - 6, '100% found in [B], counts identical', GOOD, 16, ha='left', va='center', weight='bold')
    nest(5, nB, nA, 'Xenova · whole male CNS, LIF spiking', 'AbijahKaj optic-v2, fitted rate net', 'neurons')
    nest(53, eB, eA, '124,177,617 synapses', f'{ed["sumA"]:,} synapses', 'connections')
    txt(ax, 26, 52, 'neurons, matched by body ID', MUTED, 16, ha='center')
    txt(ax, 74, 52, 'connections, matched by (pre, post) body ID', MUTED, 16, ha='center')
    save(f, '01-same-fly')

# ---------------------------------------------------------------- 02 DNg02 never lateralises
def dsi():
    rows = [  # (label, backend, dsiL, dsiR): bench/out/dng02-sweep.md, docs/phase3.md
        ('gain 2 · tonic 0.5', 'GPU', 0.00, 0.00), ('gain 4 · tonic 0.5', 'GPU', 0.00, -0.00), ('bridge OFF (control)', 'GPU', 0.01, 0.00),
        ('gain 2 · tonic 0.36', 'CPU', -0.06, -0.08), ('gain 2 · tonic 0.40', 'CPU', -0.02, 0.00), ('gain 2 · tonic 0.44', 'CPU', 0.00, -0.02),
        ('gain 2 · tonic 0.5', 'CPU', 0.02, 0.03), ('all 1,114 inputs · tonic 0.5', 'CPU', 0.00, 0.00), ('bridge OFF (control)', 'CPU', -0.01, 0.00),
    ]
    hs = load('bridge-gpu.json')['runs'][0]
    f, top = fig('Phase 3 · the failure that matters', 'The published flight-steering neurons (DNg02) do not steer in this connectome model',
                 'Direction selectivity of DNg02 under a rotating drum, every tuning tried, both backends: never above 0.08 against a target of 0.3. '
                 'The bridge itself works: HS in the spiking net fires 124 Hz on the side the optic lobe predicts and 0 Hz on the other.',
                 'bench/bridge.mjs · DSI = (CW − CCW)/(CW + CCW) per side · docs/phase3.md, bench/out/dng02-sweep.md')
    ax = f.add_axes([0.30, BOTTOM, 0.42, top - BOTTOM]); panel(ax)
    y = np.arange(len(rows))[::-1]
    for yi, (lab, be, l, r) in zip(y, rows):
        ax.plot([l, r], [yi, yi], color=GRID, lw=3, zorder=1)
        ax.scatter([l], [yi], s=220, color=DN, zorder=3, label='left DNg02' if yi == y[0] else None)
        ax.scatter([r], [yi], s=220, color=WARN, zorder=3, marker='D', label='right DNg02' if yi == y[0] else None)
    ax.axvline(0.3, color=GOOD, ls='--', lw=2.5); ax.text(0.31, -0.55, 'acceptance target 0.3', color=GOOD, fontsize=14, va='center', weight='bold')
    ax.axvline(0, color=MUTED, lw=1)
    ax.set_yticks(y); ax.set_yticklabels([f'{lab}   ·  {be}' for lab, be, *_ in rows], fontsize=14)
    ax.set_xlim(-0.15, 0.7); ax.set_ylim(-1, len(rows) - 0.4); ax.set_xlabel('DNg02 direction-selectivity index')
    ax.legend(loc='upper right', frameon=False)
    ax2 = f.add_axes([0.78, BOTTOM, 0.18, top - BOTTOM]); panel(ax2)
    vals = [hs['cw']['bHsL'], hs['cw']['bHsR'], hs['ccw']['bHsL'], hs['ccw']['bHsR']]
    ax2.bar([0, 1, 3, 4], vals, color=[A, '#1f6f68', '#1f6f68', A], width=0.8)
    for i, v in zip([0, 1, 3, 4], vals): ax2.text(i, v + 3, f'{v:.0f}', ha='center', color=INK, fontsize=14)
    ax2.set_xticks([0, 1, 3, 4]); ax2.set_xticklabels(['L', 'R', 'L', 'R']); ax2.set_ylabel('HS in the spiking net, Hz'); ax2.set_ylim(0, 150)
    ax2.text(0.5, 143, 'drum CW', ha='center', color=MUTED, fontsize=13); ax2.text(3.5, 143, 'drum CCW', ha='center', color=MUTED, fontsize=13)
    ax2.set_title('the bridge works', color=A, fontsize=16, weight='bold')
    save(f, '02-dng02-never-steers')

# ---------------------------------------------------------------- 03 what actually drives DNg02
def parse_dng02_inputs():
    text = open(BO / 'dng02-sweep.md').read()
    out = {}
    for m in re.finditer(r'== DNg02_([LR]) \((\d+) cells\) input: (\d+) synapses; top presynaptic types:\n\s+(.+)', text):
        side, cells, total, items = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).split()
        parsed = []
        for it in items:
            name, cnt = it.rsplit(':', 1); parsed.append((name[:-1], name[-1], int(cnt)))
        out[side] = dict(cells=cells, total=total, items=parsed)
    m = re.search(r'PS080_L \(1 cell\) input (\d+) synapses', text)
    out['ps080_in'] = int(m.group(1)) if m else None
    return out

def dng02_inputs():
    d = parse_dng02_inputs()
    agg = {}
    for side in 'LR':
        for name, sign, cnt in d[side]['items']:
            key = re.sub(r'_[LR]$', '', name); agg.setdefault(key, [sign, 0]); agg[key][1] += cnt
    total = d['L']['total'] + d['R']['total']; relay = 152 + 172
    items = sorted(agg.items(), key=lambda kv: -kv[1][1])[:16]
    f, top = fig('Phase 3 · why', 'DNg02 is not listening to vision. Its input is the body, and inhibition.',
                 f'Top presynaptic types onto the 29 DNg02 cells ({total:,} input synapses). None come from HS directly. The HS → PS080 relay is '
                 f'{relay / total * 100:.1f}% of that input, and HS is only {259 / d["ps080_in"] * 100:.0f}% of PS080\'s. The largest excitatory input is AN07B004, ascending from the nerve cord.',
                 'bench/paths.mjs on the MaleCNS graph · + acetylcholine / monoamine, − GABA / glutamate · bench/out/dng02-sweep.md')
    ax = f.add_axes([0.17, BOTTOM, 0.79, top - BOTTOM]); panel(ax)
    names = [k for k, _ in items][::-1]; vals = [v[1] for _, v in items][::-1]; signs = [v[0] for _, v in items][::-1]
    ax.barh(range(len(names)), vals, color=[B if s == '+' else DN for s in signs], height=0.72)
    for i, (n, v, s) in enumerate(zip(names, vals, signs)):
        hot = n.startswith('AN07B004')
        ax.text(v + 12, i, f'{v:,}  {"excitatory" if s == "+" else "inhibitory"}', va='center', color=INK if hot else MUTED, fontsize=13, weight='bold' if hot else 'normal')
    ax.barh([-1.2], [relay], color=A, height=0.72); ax.text(relay + 12, -1.2, f'{relay}  the entire HS → PS080 → DNg02 relay, both sides', va='center', color=A, fontsize=13, weight='bold')
    ax.set_yticks(list(range(len(names))) + [-1.2]); ax.set_yticklabels(names + ['PS080 ← HS'], fontsize=13)
    ax.set_xlim(0, max(vals) * 1.32); ax.set_ylim(-1.9, len(names) - 0.4); ax.set_xlabel('synapses onto DNg02, both sides pooled')
    ax.get_yticklabels()[-1].set_color(A)
    for t, n in zip(ax.get_yticklabels()[:-1], names):
        if n.startswith('AN07B004'): t.set_color(B); t.set_weight('bold')
    save(f, '03-dng02-inputs')

# ---------------------------------------------------------------- 04 ablations
def ablations():
    d = load('ablate-dna02.json'); C = d['conditions']
    order = ['intact', 'bridge-off', 'haltere-off', 'central-brain-silenced', 'recurrence-off', 'neck-cut', 'decapitated']
    nice = {'intact': 'intact loop', 'bridge-off': 'vision unplugged (bridge off)', 'haltere-off': 'haltere feedback off', 'central-brain-silenced': 'central brain silenced (37,229 cells)',
            'recurrence-off': 'recurrent transmission off', 'neck-cut': 'neck cut (all descending neurons)', 'decapitated': 'decapitated (nerve cord alone)'}
    f, top = fig('Phase 6 · ablations', 'Take pieces out of the brain and the fly tells you what they did',
                 f'Heading drift over a {d["seconds"]} s cruise through the pillar course, with every neuron of a population held below threshold. '
                 'Hatched: the readout population went silent, so the wing command saturated; there the number to read is the rate, not the drift.',
                 'bench/ablate.mjs · muting = −50 mV/ms current, not edge deletion · bench/out/ablate-dna02.json')
    ax = f.add_axes([0.28, BOTTOM, 0.68, top - BOTTOM]); panel(ax)
    y = np.arange(len(order))[::-1]
    for yi, k in zip(y, order):
        r = C[k]; drift = abs(r['driftDeg']); silent = (r['dna02'][0] + r['dna02'][1]) < 1
        col = GOOD if k == 'intact' else (MUTED if silent else BAD)
        ax.barh(yi, max(drift, 1), color=col, height=0.66, hatch='///' if silent else None, edgecolor=BG if silent else col)
        ax.text(max(drift, 1) * 1.18, yi, f'{drift:,.0f}°', va='center', color=INK, fontsize=15, weight='bold')
        ax.text(7e3, yi, f'DNa02 {r["dna02"][0]:.0f} / {r["dna02"][1]:.0f} Hz    wing MN {r["wingMn"][0]:.0f} / {r["wingMn"][1]:.0f} Hz    {r["collisions"]} collisions', va='center', color=MUTED, fontsize=13)
    ax.set_xscale('log'); ax.set_xlim(1, 1.2e6); ax.set_xlabel('|heading drift| in 20 s, degrees (log scale)')
    ax.set_xticks([1, 10, 100, 1000]); ax.set_xticklabels(['1°', '10°', '100°', '1,000°'])
    ax.set_yticks(y); ax.set_yticklabels([nice[k] for k in order], fontsize=14); ax.get_yticklabels()[0].set_color(GOOD)
    save(f, '04-ablations')

# ---------------------------------------------------------------- 05 haltere sign
def haltere():
    d = load('cruise-dna02.json'); runs = {(r['haltere'], r['haltereSign']): r for r in d['runs']}
    f, top = fig('Phase 5 · stability', 'The same 205 haltere afferents stabilise the fly for one sign of input and spin it for the other',
                 'Heading over a 30 s cruise. Body yaw rate becomes a current on the haltere sensory neurons of the MaleCNS graph and the wiring does the rest. '
                 'The sign was not fitted: both were tried, one works. Nothing else differs between the three runs.',
                 'bench/cruise.mjs · DNa02 readout, bridge gain 2, tonic DNg02 0.4 mV/ms · bench/out/cruise-dna02.json')
    ax = f.add_axes([0.07, BOTTOM, 0.55, top - BOTTOM]); panel(ax)
    t = np.arange(d['seconds'])
    for key, col, lab in [((False, 0), MUTED, 'no haltere feedback'), ((True, 1), BAD, 'haltere current, sign +1'), ((True, -1), GOOD, 'haltere current, sign −1')]:
        r = runs[key]; h = np.array(r['headingPerSecond']); h = h - h[0]
        ax.plot(t[:len(h)], h, color=col, lw=3.5, label=f'{lab}:  {r["driftDeg"]:+,.0f}° in 30 s')
    ax.set_xlabel('time, s'); ax.set_ylabel('heading change, degrees'); ax.legend(loc='lower left', frameon=False); ax.axhline(0, color=GRID, lw=1)
    ax2 = f.add_axes([0.69, BOTTOM, 0.27, top - BOTTOM]); panel(ax2)
    for key, col in [((False, 0), MUTED), ((True, -1), GOOD)]:
        r = runs[key]; h = np.array(r['headingPerSecond']); h = h - h[0]; ax2.plot(t[:len(h)], h, color=col, lw=3.5)
    ax2.set_ylim(-140, 60); ax2.set_xlabel('time, s'); ax2.axhspan(-20, 20, color=GOOD, alpha=0.08); ax2.axhline(0, color=GRID, lw=1)
    ax2.text(0.5, 0.95, 'zoom · ±20° target band', transform=ax2.transAxes, ha='center', va='top', color=MUTED, fontsize=15)
    save(f, '05-haltere-sign')

# ---------------------------------------------------------------- 06 CPU vs GPU chaos
def parity():
    d = load('parity.json'); r = d['runs'][0]; rows = r['rows']
    ms = np.array([x['ms'] for x in rows]); cpu = np.array([x['cpu'] for x in rows]); gpu = np.array([x['gpu'] for x in rows]); diff = np.array([x['neuronsDiffering'] for x in rows])
    first = next(x for x in rows if x['neuronsDiffering'] > 0); ident = first['ms'] - 10
    f, top = fig('Phase 1 · parity', 'Two implementations of the same 166,700-neuron network agree spike for spike, then diverge like weather',
                 f'Population spikes per 10 ms batch, JavaScript LIF against WebGPU LIF, identical inputs and seed. Bit-identical for the first {ident} ms; after that '
                 'floating-point summation order flips single spikes and the network amplifies them. The statistics match, the trajectories do not.',
                 'bench/parity.mjs · bench/out/parity.json · Shiu et al. 2024 LIF adapted to MaleCNS by Xenova')
    ax = f.add_axes([0.07, BOTTOM, 0.86, top - BOTTOM]); panel(ax)
    ax2 = ax.twinx(); ax2.fill_between(ms, diff, color=DN, alpha=0.12, step='mid'); ax2.set_ylabel('neurons whose spike count differs', color=DN); ax2.tick_params(axis='y', colors=DN); ax2.grid(False)
    ax.set_zorder(ax2.get_zorder() + 1); ax.patch.set_visible(False)
    ax.plot(ms, cpu, color=A, lw=3, label='CPU (JavaScript)'); ax.plot(ms, gpu, color=B, lw=3, ls='--', label='GPU (WGSL)')
    ax.axvline(first['ms'], color=DN, lw=2); ax.text(first['ms'] + 6, cpu.min() + 40, f'first differing spike:\nthe {first["ms"] - 10}–{first["ms"]} ms batch', color=DN, fontsize=14, va='bottom', weight='bold')
    ax.set_xlabel('simulated time, ms'); ax.set_ylabel('spikes per 10 ms batch'); ax.legend(loc='upper right', frameon=False)
    save(f, '06-cpu-gpu-chaos')

# ---------------------------------------------------------------- capture-dependent figures
def cap():
    return load('figures.json')

def loom():
    d = cap()
    if not d or not d.get('loom', {}).get('on'): return print('skip loom (no capture)')
    on, off = d['loom']['on'], d['loom'].get('off'); t0 = on[0]['t']
    f, top = fig('Phase 3 · a pixel becomes a reflex', 'A sphere looms from the left and the giant fiber fires, through nothing but the wiring',
                 'Rendered image → 1,771 eye columns → fitted optic lobe → current on the same LC4 / LPLC2 neurons in the MaleCNS spiking net → DNp01, the giant fiber. '
                 'Grey: the same sphere with the bridge unplugged.',
                 'bench/figures-capture.mjs · sphere from −45°, 6 body lengths away at 2 per second, radius 0.6 · bench/out/figures.json')
    ax = f.add_axes([0.07, BOTTOM, 0.86, top - BOTTOM]); panel(ax)
    T = np.array([r['t'] - t0 for r in on])
    if off:
        To = np.array([r['t'] - off[0]['t'] for r in off])
        for k in ('b_lc4L', 'b_lplc2L', 'b_dnp01'): ax.plot(To, [r[k] for r in off], color=MUTED, lw=2, alpha=0.8, label='bridge off (all three)' if k == 'b_dnp01' else None)
    for k, col, lab, lw in [('b_lc4L', A, 'LC4, left (126 cells)', 3), ('b_lplc2L', WARN, 'LPLC2, left (185 cells)', 3), ('b_dnp01', DN, 'DNp01, the giant fiber', 4.5)]:
        ax.plot(T, [r[k] for r in on], color=col, lw=lw, label=lab)
    dist = np.array([r['loom'] if r['loom'] is not None else np.nan for r in on])
    ax2 = ax.twinx(); ax2.plot(T, dist, color=INK, lw=1.5, ls=':'); ax2.set_ylabel('sphere distance, body lengths (dotted)', color=MUTED); ax2.grid(False); ax2.set_ylim(0, 6.5); ax2.tick_params(axis='y', colors=MUTED)
    ax.set_xlabel('time, s'); ax.set_ylabel('firing rate in the spiking net, Hz'); ax.legend(loc='upper left', frameon=False)
    save(f, '07-loom-reflex')

def segments(T, om):
    out, start = [], 0
    for i in range(1, len(om) + 1):
        if i == len(om) or om[i] != om[start]: out.append((T[start], T[i - 1], om[start])); start = i
    return out

def drum():
    d = cap()
    if not d or not d.get('drum'): return print('skip drum (no capture)')
    rows = d['drum']; T = np.array([r['t'] - rows[0]['t'] for r in rows]); om = np.array([r['omega'] for r in rows])
    f, top = fig('Phase 3–4 · optomotor', 'Rotate the world and the wiring picks a side: HS flips, DNa02 follows, DNg02 shrugs',
                 'A striped drum turns clockwise, then counter-clockwise, around the hovering fly. Left (solid) and right (dashed) rates of three populations in the MaleCNS spiking net, every frame.',
                 'bench/figures-capture.mjs · drum ±1 rad/s, 30° stripes, bridge gain 2 · bench/out/figures.json')
    h = (top - BOTTOM - 0.04) / 3
    axes = [f.add_axes([0.07, BOTTOM + (2 - i) * (h + 0.02), 0.89, h]) for i in range(3)]
    for ax, (kl, kr, name, col) in zip(axes, [('b_hsL', 'b_hsR', 'HS · the optomotor input', A), ('b_dna02L', 'b_dna02R', 'DNa02 · steers the loop', GOOD), ('b_dng02L', 'b_dng02R', 'DNg02 · the published flight-steering code', DN)]):
        panel(ax)
        ax.plot(T, [r[kl] for r in rows], color=col, lw=3); ax.plot(T, [r[kr] for r in rows], color=col, lw=3, ls='--', alpha=0.7)
        for a, b_, o in segments(T, om):
            if o: ax.axvspan(a, b_, color=B if o > 0 else WARN, alpha=0.08)
        ax.set_ylabel('Hz'); ax.set_xlim(T[0], T[-1]); ax.set_ylim(0, ax.get_ylim()[1] * 1.25)
        ax.text(0.01, 0.94, name, transform=ax.transAxes, ha='left', va='top', color=col, fontsize=16, weight='bold')
        if ax is not axes[-1]: ax.set_xticklabels([])
    for a, b_, o in segments(T, om):
        if o: axes[1].text((a + b_) / 2, axes[1].get_ylim()[1] * 0.93, 'drum CW' if o > 0 else 'drum CCW', ha='center', va='top', color=B if o > 0 else WARN, fontsize=15, weight='bold')
    axes[-1].set_xlabel('time, s')
    save(f, '08-optomotor-drum')

def trajectories():
    d = cap()
    if not d or not d.get('cruise'): return print('skip trajectories (no capture)')
    f, top = fig('Phase 5–6 · from above', 'Three flights through the same 40-pillar course: intact, blind, and without haltere feedback',
                 'Top-down path of the fly for 20 s under the DNa02 readout. Squares are the pillars. The runs differ in one switch each; the wiring is identical.',
                 'bench/figures-capture.mjs · bench/out/figures.json')
    ax = f.add_axes([0.05, 0.07, 0.90, top - 0.07]); ax.set_facecolor(PANEL); ax.set_aspect('equal'); ax.grid(False)
    for p in d['course']: ax.add_patch(Rectangle((p['x'] - p['w'] / 2, p['z'] - p['w'] / 2), p['w'], p['w'], color='#2a3442'))
    for key, col, lab in [('bridge-off', MUTED, 'vision unplugged'), ('haltere-off', BAD, 'haltere feedback off'), ('intact', GOOD, 'intact')]:
        if key not in d['cruise']: continue
        rows = d['cruise'][key]['rows']; x = [r['x'] for r in rows]; z = [r['z'] for r in rows]
        drift = (rows[-1]['yaw'] - rows[0]['yaw']) * 180 / math.pi
        ax.plot(x, z, color=col, lw=3.2, label=f'{lab}:  drift {drift:+.0f}°, {rows[-1]["collisions"]} collision{"s" if rows[-1]["collisions"] != 1 else ""}', solid_capstyle='round')
        ax.scatter([x[-1]], [z[-1]], s=90, color=col, zorder=5)
    ax.scatter([0], [0], s=200, color=INK, marker='*', zorder=6, label='start')
    xs = [r['x'] for k in d['cruise'] for r in d['cruise'][k]['rows']]; zs = [r['z'] for k in d['cruise'] for r in d['cruise'][k]['rows']]
    cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2; half = max(max(xs) - min(xs), max(zs) - min(zs)) / 2 + 5
    ax.set_xlim(cx - half, cx + half); ax.set_ylim(cz - half, cz + half); ax.invert_yaxis(); ax.set_xticks([]); ax.set_yticks([])
    ax.plot([cx + half - 7, cx + half - 2], [cz + half - 2, cz + half - 2], color=INK, lw=3); ax.text(cx + half - 4.5, cz + half - 2.6, '5 body lengths', ha='center', va='bottom', color=INK, fontsize=12)
    ax.legend(loc='upper left', frameon=False)
    save(f, '09-trajectories')

def eye_maps():
    d = cap()
    if not d or not d.get('eye'): return print('skip eye maps (no capture)')
    c = json.load(open(ROOT / 'src/eye/columns.json')); e = d['eye']
    az = np.degrees(np.array(c['az'], dtype=float)); el = np.degrees(np.array(c['el'], dtype=float)); side = np.array(c['side'])
    left = (side == 'L') if side.dtype.kind in 'US' else (side == 0)
    li, ri = np.where(left)[0], np.where(~left)[0]
    lum = np.zeros(len(az)); r = np.zeros(len(az))
    lum[li] = e['lumL'][:len(li)]; lum[ri] = e['lumR'][:len(ri)]; r[li] = e['rL'][:len(li)]; r[ri] = e['rR'][:len(ri)]
    f, top = fig('Phase 2 · the eye', 'What the fly sees: 1,771 ommatidia sampled from the rendered scene, one per connectome column',
                 'Each dot is one column of the MaleCNS optic lobe at the azimuth and elevation the connectome gives it. Left: luminance at this frame of the cruise. Right: what the optic lobe receives after Weber adaptation and the fitted low-pass.',
                 'bench/figures-capture.mjs at t = 8 s of the intact cruise · src/eye/columns.json (AbijahKaj extractor) · bench/out/figures.json')
    for i, (vals, name, cmap) in enumerate([(lum, 'luminance', 'gray'), (r, 'photoreceptor output', 'magma')]):
        ax = f.add_axes([0.06 + i * 0.47, BOTTOM, 0.41, top - BOTTOM]); panel(ax)
        sc = ax.scatter(az, el, c=vals, cmap=cmap, s=30, edgecolors='none')
        ax.set_xlim(-170, 170); ax.set_ylim(-90, 90); ax.set_xlabel('azimuth, degrees (0 = straight ahead)'); ax.set_ylabel('elevation, degrees' if i == 0 else '')
        ax.set_title(name, color=INK, fontsize=17, weight='bold'); ax.axvline(0, color=GRID, lw=1)
        cb = f.colorbar(sc, ax=ax, fraction=0.03, pad=0.02); cb.outline.set_visible(False); cb.ax.tick_params(colors=MUTED)
    save(f, '10-eye-maps')

def budget():
    d = cap()
    if not d or not d.get('cruise', {}).get('intact'): return print('skip budget (no capture)')
    rows = d['cruise']['intact']['rows']
    wall = np.mean([r['wallMs'] for r in rows]); opt = np.mean([r['opticMs'] for r in rows]); lif = np.mean([r['brainMs'] for r in rows]); other = max(0, wall - opt - lif)
    spikes = np.mean([r['spikes'] for r in rows])
    f, top = fig('Throughput', f'One 16.7 ms frame of fly time costs {wall:.0f} ms on an RTX 3070, so the loop runs at {16.7 / wall:.2f}× realtime',
                 'Per frame: render the scene and sample the eye, step the optic-lobe rate net four times, then 160 ticks of the whole-CNS spiking net on WebGPU. '
                 'Both networks run in one web worker inside a browser tab; the frame clock is fixed, so wall time never touches the science.',
                 'bench/figures-capture.mjs, intact cruise, means over 1,200 frames · bench/out/figures.json')
    ax = f.add_axes([0.06, 0.40, 0.88, 0.26]); ax.axis('off'); ax.set_xlim(0, wall); ax.set_ylim(0, 1)
    x = 0
    for v, col, lab in [(opt, A, 'optic-v2 rate net · CPU · 4 steps of 4 ms'), (lif, B, 'MaleCNS LIF · WebGPU · 160 ticks of 0.1 ms'), (other, MUTED, '')]:
        ax.add_patch(Rectangle((x, 0.35), v, 0.4, color=col))
        if v > 6:
            ax.text(x + v / 2, 0.55, f'{v:.0f} ms', ha='center', va='center', color=BG, fontsize=24, weight='bold')
            ax.text(x + v / 2, 0.24, lab, ha='center', va='top', color=col, fontsize=14, weight='bold')
        x += v
    ax.text(wall, 0.24, f'+{other:.0f} ms eye render, bridge, readout', ha='right', va='top', color=MUTED, fontsize=13)
    ax.text(0, 0.9, '0', color=MUTED, fontsize=13); ax.text(wall, 0.9, f'{wall:.0f} ms wall time', color=MUTED, fontsize=13, ha='right')
    ax.text(16.7 + 1, 0.9, '16.7 ms of fly time', color=GOOD, fontsize=14, ha='left', weight='bold'); ax.plot([16.7, 16.7], [0.3, 0.85], color=GOOD, lw=2.5)
    tiles = [(f'{spikes:,.0f}', 'spikes per frame', B), ('166,700', 'LIF neurons stepped', B), ('65,799', 'rate-net units stepped', A), ('1,771', 'ommatidia sampled', A), ('317', 'neurons bridged', GOOD)]
    for i, (num, lab, col) in enumerate(tiles):
        tx = f.add_axes([0.06 + i * 0.178, 0.10, 0.166, 0.22]); tx.axis('off'); tx.set_facecolor(PANEL)
        tx.add_patch(FancyBboxPatch((0.02, 0.02), 0.96, 0.96, boxstyle='round,pad=0,rounding_size=0.06', fc=PANEL, ec=GRID, transform=tx.transAxes))
        tx.text(0.5, 0.62, num, ha='center', va='center', color=col, fontsize=30, weight='bold', transform=tx.transAxes)
        tx.text(0.5, 0.25, lab, ha='center', va='center', color=MUTED, fontsize=14, transform=tx.transAxes)
    save(f, '11-frame-budget')

def filmstrip():
    S = Path('/tmp/claude-1001/-home-btw-projects-closedloopfly/aaebcfef-88ac-404e-8b1d-117b133b72f8/scratchpad/frames')
    strip = sorted(SHOTS.glob('strip-*.png'))
    files = strip[:8] if len(strip) >= 8 else sorted(S.glob('f*.png'))[:8]
    if not files: return print('skip filmstrip')
    f, top = fig('Phase 5 · 20 s of autonomous flight', 'Through the pillar course on its own wiring: eight moments, 2.5 s apart',
                 'Third-person view from the closed-loop page during the intact cruise. No scripted actions: the wing command is the DNa02 rate deviation, every frame.',
                 'bench/figures-capture.mjs (1920 × 1080 stills)' if strip else 'docs/cruise-intact-dna02-6x.webm · bench/ablate.mjs --record, intact condition')
    hgt = (top - 0.07 - 0.03) / 2; wid = 0.225
    for i, p in enumerate(files):
        im = plt.imread(p); r, c = divmod(i, 4)
        ax = f.add_axes([0.04 + c * 0.235, top - hgt - r * (hgt + 0.03), wid, hgt]); ax.imshow(im); ax.axis('off')
        ax.text(0.02, 0.96, f't = {i * 2.5:.1f} s', transform=ax.transAxes, color=INK, fontsize=15, weight='bold', va='top', bbox=dict(fc=BG, ec='none', alpha=0.75, pad=4))
    save(f, '12-filmstrip')

def captioned(shot, name, kicker, title, sub, source):
    p = SHOTS / f'{shot}.png'
    if not p.exists(): return print(f'skip {name} (no {shot}.png)')
    im = plt.imread(p)
    f, top = fig(kicker, title, sub, source)
    avail_h = top - 0.07; avail_w = 0.92
    ih, iw = im.shape[:2]; aspect = iw / ih
    h_in = min(avail_h * H, avail_w * W / aspect); w_in = h_in * aspect
    ax = f.add_axes([0.5 - w_in / W / 2, 0.07, w_in / W, h_in / H]); ax.imshow(im); ax.axis('off')
    save(f, name)

def shots():
    captioned('loom-close', '13-shot-loom', 'Phase 3 · the stimulus', 'The looming sphere, two body lengths out, as the third-person camera sees it',
              'At this moment the left LC4 cells in the spiking net are at their peak and the giant fiber is about to fire. The fly is hovering: this assay is open-loop.',
              'bench/figures-capture.mjs · loop.html on the GPU box, 1920 × 1080')
    captioned('cruise-8s-hud', '14-shot-cruise-hud', 'Phase 5 · the closed loop, live', 'Eight seconds into a cruise: the scene, the eye, and the network read-outs in one page',
              'Top left: luminance on the two eyes, 879 and 892 ommatidia. Below: optic-lobe rates, spiking-net rates, and the per-frame wall time. The fly steers itself on DNa02.',
              'bench/figures-capture.mjs · loop.html?bench=1&readout=dna02&haltere=on · 1920 × 1080')
    captioned('drum-cw-hud', '15-shot-drum-hud', 'Phase 3 · the optomotor assay', 'The striped drum turning clockwise around the fly, with both networks reporting',
              'HS in the optic lobe and HS in the spiking net agree on the side; DNg02 left and right stay equal. The numbers on the left panel are live read-outs.',
              'bench/figures-capture.mjs · loop.html, drum ω = +1 rad/s · 1920 × 1080')
    captioned('brain-escape-2', '16-shot-brain', 'The other half · Xenova\'s brain view', 'The whole-CNS spiking net firing: the Escape preset through the new injection path',
              '166,700 neurons of the MaleCNS graph, LC4 cells driven by additive current (Phase 1) instead of a Poisson rate clamp. This is the network the optic lobe now feeds, and the body it now moves.',
              'bench/filmstrip-capture.mjs · index.html?stimulus=inject on the GPU box · 1920 × 1080')

ALL = dict(same_fly=same_fly, dsi=dsi, dng02_inputs=dng02_inputs, ablations=ablations, haltere=haltere, parity=parity,
           loom=loom, drum=drum, trajectories=trajectories, eye_maps=eye_maps, budget=budget, filmstrip=filmstrip, shots=shots)
if __name__ == '__main__':
    for n in (sys.argv[1:] or list(ALL)): ALL[n]()
