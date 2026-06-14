# @purpose Metric bake-off step 3: correlate each deterministic metric (and
# simple combos) against vision-judge tile scores. Spearman + Pearson, per
# site and pooled. Also: pre-filter threshold analysis (Q-a), top
# disagreement tiles (Q-b input), cross-width stability proxy (Q-c).
# Usage: /tmp/mb-venv/bin/python correlate.py
import json, os
import numpy as np
from scipy import stats

HERE = os.path.dirname(os.path.abspath(__file__))
rows = [json.loads(l) for l in open(os.path.join(HERE, 'results.jsonl'))]

METRICS = ['ssim', 'edge_iou', 'hist_sim', 'block_luma_std', 'mean_abs_diff', 'lpips']
# sign: +1 = higher is better, -1 = lower is better
SIGN = {'ssim': 1, 'edge_iou': 1, 'hist_sim': 1, 'block_luma_std': -1,
        'mean_abs_diff': -1, 'lpips': -1}

def rank01(vals):
    r = stats.rankdata(vals)
    return (r - 1) / (len(r) - 1) if len(r) > 1 else r * 0

# --- combos (computed pooled, using rank-normalized signed metrics) ---
def add_combos(rs):
    signed = {m: np.array([SIGN[m] * r[m] for r in rs]) for m in METRICS}
    rk = {m: rank01(signed[m]) for m in METRICS}
    combos = {
        'combo_edge+lpips': (rk['edge_iou'] + rk['lpips']) / 2,
        'combo_edge+hist': (rk['edge_iou'] + rk['hist_sim']) / 2,
        'combo_edge+lpips+hist': (rk['edge_iou'] + rk['lpips'] + rk['hist_sim']) / 3,
        'combo_ssim+edge': (rk['ssim'] + rk['edge_iou']) / 2,
        'combo_all6_rankavg': sum(rk[m] for m in METRICS) / 6,
    }
    return combos

judge = np.array([r['judge'] for r in rows], dtype=float)
sites = sorted(set(r['site'] for r in rows))

print('=== CORRELATION vs judge tile score (n=%d) ===' % len(rows))
header = f"{'metric':24s} " + ' '.join(f'{s:>10s}' for s in sites) + f" {'POOLED-sp':>10s} {'POOLED-pe':>10s}"
print(header)
table = {}
for m in METRICS:
    vals = np.array([SIGN[m] * r[m] for r in rows])
    cells = []
    for s in sites:
        mask = np.array([r['site'] == s for r in rows])
        sp = stats.spearmanr(vals[mask], judge[mask]).statistic
        cells.append(f'{sp:>10.3f}')
    sp_all = stats.spearmanr(vals, judge).statistic
    pe_all = stats.pearsonr(vals, judge).statistic
    table[m] = sp_all
    print(f'{m:24s} ' + ' '.join(cells) + f' {sp_all:>10.3f} {pe_all:>10.3f}')

combos = add_combos(rows)
for name, vals in combos.items():
    cells = []
    for s in sites:
        mask = np.array([r['site'] == s for r in rows])
        sp = stats.spearmanr(vals[mask], judge[mask]).statistic
        cells.append(f'{sp:>10.3f}')
    sp_all = stats.spearmanr(vals, judge).statistic
    pe_all = stats.pearsonr(vals, judge).statistic
    table[name] = sp_all
    print(f'{name:24s} ' + ' '.join(cells) + f' {sp_all:>10.3f} {pe_all:>10.3f}')

print('\nper-site n: ' + ', '.join(f"{s}={sum(1 for r in rows if r['site']==s)}" for s in sites))

# --- Q-a: pre-filter thresholds -------------------------------------------
# Judge bands: good >= 80, bad <= 50 (matching vision-judge severity bands).
# For the best single metric and best combo, find thresholds that classify
# obvious-good / obvious-bad with ~100% precision on this data.
best_combo_name = max(combos, key=lambda k: table[k])
best_metric = max(METRICS, key=lambda k: table[k])
print(f'\n=== Q-a PRE-FILTER (best metric: {best_metric}, best combo: {best_combo_name}) ===')

def prefilter(vals, label, good_cut=80, bad_cut=50):
    order = np.argsort(vals)
    j = judge
    # bad threshold: largest metric value v such that all tiles with vals<=v have judge<bad-ish
    # we require precision 1.0 for "obvious-bad" = judge < good_cut (not good),
    # and stronger: judge <= 65 (clearly not shippable)
    cands_bad = sorted(set(vals))
    best_bad, n_bad = None, 0
    for v in cands_bad:
        m = vals <= v
        if m.sum() == 0: continue
        if (j[m] <= 65).all():
            if m.sum() > n_bad: best_bad, n_bad = v, int(m.sum())
        else:
            break
    best_good, n_good = None, 0
    for v in sorted(set(vals), reverse=True):
        m = vals >= v
        if m.sum() == 0: continue
        if (j[m] >= 70).all():
            if m.sum() > n_good: best_good, n_good = v, int(m.sum())
        else:
            break
    n = len(vals)
    print(f'{label}: obvious-bad (judge<=65 guaranteed) below {best_bad}: {n_bad}/{n} = {n_bad/n:.0%}')
    print(f'{label}: obvious-good (judge>=70 guaranteed) above {best_good}: {n_good}/{n} = {n_good/n:.0%}')
    print(f'{label}: contested middle for judge: {(n-n_bad-n_good)/n:.0%}')
    return best_bad, best_good

vals_bm = np.array([SIGN[best_metric] * r[best_metric] for r in rows])
prefilter(vals_bm, best_metric)
prefilter(combos[best_combo_name], best_combo_name)

# --- Q-b: disagreement tiles -----------------------------------------------
# Fit a 1-D monotone map (linear on ranks) from best combo -> judge, find the
# 5 largest |predicted - judge| tiles.
print(f'\n=== Q-b DISAGREEMENT TILES (combo={best_combo_name}) ===')
cv = combos[best_combo_name]
# linear fit rank -> judge
A = np.vstack([cv, np.ones_like(cv)]).T
coef, *_ = np.linalg.lstsq(A, judge, rcond=None)
pred = A @ coef
resid = pred - judge
order = np.argsort(-np.abs(resid))
for i in order[:8]:
    r = rows[i]
    d = 'metric>>judge (metric kinder)' if resid[i] > 0 else 'judge>>metric (judge kinder)'
    print(f"{r['site']:10s} w{r['width']} idx{r['idx']:02d} judge={r['judge']:3.0f} pred={pred[i]:5.1f} resid={resid[i]:+6.1f} {d}")
    print(f"   ssim={r['ssim']:.3f} edge={r['edge_iou']:.3f} hist={r['hist_sim']:.3f} lpips={r['lpips']:.3f} mad={r['mean_abs_diff']:.3f} tile=/tmp/vj-*/{('w%d-tile-%02d.png' % (r['width'], r['idx']))}")

# --- Q-c: stability proxy ---------------------------------------------------
# Same site, same tile idx at two widths = same content region rendered twice.
# Metric whose value agrees most across widths (Spearman of w1440 vs w1100
# vectors over matched idx) is the most stable regression-check candidate.
print('\n=== Q-c CROSS-WIDTH STABILITY (Spearman of metric@1440 vs metric@1100, matched idx) ===')
by_key = {(r['site'], r['width'], r['idx']): r for r in rows}
pairs = []
for r in rows:
    if r['width'] == 1440:
        o = by_key.get((r['site'], 1100, r['idx']))
        if o: pairs.append((r, o))
print(f'matched cross-width pairs: {len(pairs)}')
for m in METRICS:
    a = np.array([p[0][m] for p in pairs]); b = np.array([p[1][m] for p in pairs])
    sp = stats.spearmanr(a, b).statistic
    mad = np.abs(a - b).mean()
    rng = np.percentile(np.concatenate([a, b]), 95) - np.percentile(np.concatenate([a, b]), 5)
    print(f'{m:18s} spearman={sp:6.3f}  meanAbsDelta={mad:8.5f}  (5-95 range {rng:8.5f}, delta/range={mad/max(rng,1e-9):5.1%})')
ja = np.array([p[0]['judge'] for p in pairs], dtype=float); jb = np.array([p[1]['judge'] for p in pairs], dtype=float)
sp = stats.spearmanr(ja, jb).statistic
print(f"{'judge (reference)':18s} spearman={sp:6.3f}  meanAbsDelta={np.abs(ja-jb).mean():8.5f}")
