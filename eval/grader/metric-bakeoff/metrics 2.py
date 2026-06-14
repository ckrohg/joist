# @purpose Metric bake-off step 2: compute deterministic visual metrics on
# split src/clone tile halves and append one JSON line per tile to
# results.jsonl (incremental, idempotent per site+width batch).
# Metrics: SSIM (gray), edge-map IoU (canny+dilate), color-histogram
# intersection, blockwise luma-std diff, mean-abs pixel diff, LPIPS(alex).
# Usage: /tmp/mb-venv/bin/python metrics.py --site blog --width 1440
import argparse, json, os, sys, time
import numpy as np
from PIL import Image

HALVES = '/tmp/metric-bakeoff/halves'
JUDGE_DIRS = {
    'tailwind': '/tmp/vj-cal-tailwind', 'supabase': '/tmp/vj-cal-supabase',
    'resend': '/tmp/vj-cal-resend', 'blog': '/tmp/vj-cal-blog',
    'clerk': '/tmp/vj-heldout-clerk', 'htmlfirst': '/tmp/vj-htmlfirst',
}
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.jsonl')

def load_rgb(path):
    return np.asarray(Image.open(path).convert('RGB'), dtype=np.uint8)

def luma(rgb):
    return (0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2])

def m_ssim(ga, gb):
    from skimage.metrics import structural_similarity
    return float(structural_similarity(ga, gb, data_range=255.0))

def m_edge_iou(ga, gb):
    from skimage.feature import canny
    from skimage.morphology import binary_dilation, disk
    ea = canny(ga / 255.0, sigma=2.0)
    eb = canny(gb / 255.0, sigma=2.0)
    fp = disk(3)
    da, db = binary_dilation(ea, fp), binary_dilation(eb, fp)
    union = np.logical_or(da, db).sum()
    if union == 0:
        return 1.0
    return float(np.logical_and(da, db).sum() / union)

def m_hist_sim(a, b):
    # 8x8x8 RGB histogram intersection in [0,1]
    ha, _ = np.histogramdd(a.reshape(-1, 3), bins=(8, 8, 8), range=((0, 256),) * 3)
    hb, _ = np.histogramdd(b.reshape(-1, 3), bins=(8, 8, 8), range=((0, 256),) * 3)
    ha, hb = ha / ha.sum(), hb / hb.sum()
    return float(np.minimum(ha, hb).sum())

def m_block_luma_std(ga, gb, block=30):
    H, W = ga.shape
    bh, bw = H // block, W // block
    if bh == 0 or bw == 0:
        return 0.0
    ca = ga[:bh * block, :bw * block].reshape(bh, block, bw, block)
    cb = gb[:bh * block, :bw * block].reshape(bh, block, bw, block)
    sa = ca.std(axis=(1, 3))
    sb = cb.std(axis=(1, 3))
    return float(np.abs(sa - sb).mean() / 255.0)  # lower = more similar

def m_mean_abs_diff(a, b):
    return float(np.abs(a.astype(np.int16) - b.astype(np.int16)).mean() / 255.0)

_LPIPS = None
def m_lpips(pa, pb):
    global _LPIPS
    import torch, lpips
    if _LPIPS is None:
        _LPIPS = lpips.LPIPS(net='alex', verbose=False)
        _LPIPS.eval()
    def prep(p):
        im = Image.open(p).convert('RGB')
        w, h = im.size
        nw = 512
        nh = max(8, round(h * nw / w))
        im = im.resize((nw, nh), Image.LANCZOS)
        t = torch.from_numpy(np.asarray(im, dtype=np.float32) / 127.5 - 1.0)
        return t.permute(2, 0, 1).unsqueeze(0)
    with __import__('torch').no_grad():
        return float(_LPIPS(prep(pa), prep(pb)))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', required=True)
    ap.add_argument('--width', type=int, required=True)
    args = ap.parse_args()

    judge = {}
    with open(os.path.join(JUDGE_DIRS[args.site], 'results.json')) as f:
        for t in json.load(f)['tiles']:
            judge[(t['width'], t['idx'])] = t

    done = set()
    if os.path.exists(OUT):
        with open(OUT) as f:
            for line in f:
                try:
                    r = json.loads(line)
                    done.add((r['site'], r['width'], r['idx']))
                except Exception:
                    pass

    half_dir = os.path.join(HALVES, args.site)
    names = sorted(f for f in os.listdir(half_dir)
                   if f.startswith(f'w{args.width}-') and f.endswith('-src.png'))
    n_done = 0
    with open(OUT, 'a') as out:
        for name in names:
            idx = int(name.split('-tile-')[1].split('-')[0])
            if (args.site, args.width, idx) in done:
                continue
            jt = judge.get((args.width, idx))
            if jt is None or not jt.get('judged') or jt.get('score') is None:
                continue
            pa = os.path.join(half_dir, name)
            pb = os.path.join(half_dir, name.replace('-src.png', '-clone.png'))
            t0 = time.time()
            a, b = load_rgb(pa), load_rgb(pb)
            ga, gb = luma(a), luma(b)
            rec = {
                'site': args.site, 'width': args.width, 'idx': idx,
                'judge': jt['score'], 'aboveFold': jt.get('aboveFold'),
                'yRange': jt.get('yRange'),
                'ssim': round(m_ssim(ga, gb), 5),
                'edge_iou': round(m_edge_iou(ga, gb), 5),
                'hist_sim': round(m_hist_sim(a, b), 5),
                'block_luma_std': round(m_block_luma_std(ga, gb), 5),
                'mean_abs_diff': round(m_mean_abs_diff(a, b), 5),
                'lpips': round(m_lpips(pa, pb), 5),
                'sec': round(time.time() - t0, 2),
            }
            out.write(json.dumps(rec) + '\n')
            out.flush()
            n_done += 1
    print(f'{args.site} w{args.width}: wrote {n_done} rows -> {OUT}')

if __name__ == '__main__':
    main()
