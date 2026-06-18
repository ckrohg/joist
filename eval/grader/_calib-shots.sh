cd /Users/ckrohg/Documents/Claude/tenet-elementor/eval/grader
OUT=calibration/v2-shots
# fresh CURRENT-corpus pairs: name|sourceURL|cloneURL|width
shoot() { timeout 95 node _shoot.mjs "$2" "$OUT/$1.png" "$3" >/dev/null 2>&1 && echo "  ok $1" || echo "  FAIL $1"; }
echo "[calib-shots] capturing source+clone tiles..."
# desktop pairs (1440)
shoot supabase-src-d https://supabase.com 1440 ;            shoot supabase-cln-d http://localhost:8001/?page_id=454 1440
shoot linear-src-d https://linear.app 1440 ;               shoot linear-cln-d http://localhost:8001/?page_id=455 1440
shoot tailwind-src-d https://tailwindcss.com 1440 ;        shoot tailwind-cln-d http://localhost:8001/?page_id=268 1440
shoot resend-src-d https://resend.com 1440 ;               shoot resend-cln-d http://localhost:8001/?page_id=469 1440
shoot framer-src-d https://www.framer.com 1440 ;           shoot framer-cln-d http://localhost:8001/?page_id=471 1440
shoot notion-src-d https://www.notion.so 1440 ;            shoot notion-cln-d http://localhost:8001/?page_id=270 1440
# mobile pairs (390)
shoot supabase-src-m https://supabase.com 390 ;            shoot supabase-cln-m http://localhost:8001/?page_id=454 390
shoot linear-src-m https://linear.app 390 ;                shoot linear-cln-m http://localhost:8001/?page_id=455 390
echo "[calib-shots] DONE"
