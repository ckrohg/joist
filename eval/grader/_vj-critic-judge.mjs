// @purpose adversarial-critic probe runner: judges a fixed list of tiles/controls with the EXACT
// vision-judge V1 rubric + claude -p invocation, for honesty / label-bias / repeatability checks.
import fs from 'fs';
import { execFile } from 'child_process';
const MODEL='sonnet';
const RUBRIC=(tilePath,width,y0,y1)=>`You are a pixel-fidelity QA judge. Read the image file ${tilePath} now.
It is a side-by-side composite: LEFT of the vertical magenta divider is the ORIGINAL website; RIGHT is a REBUILD of the same page region (viewport width ${width}px, page band y=${y0}-${y1}; corner labels SRC/CLONE are burned in by the harness — ignore them).
Score the RIGHT side's fidelity to the LEFT, 0-100:
- 100 = indistinguishable at a glance
- 50 = same skeleton but obviously different on inspection
- below 30 = clearly broken or missing content
Enumerate EVERY visible defect of the RIGHT side relative to the LEFT. Each defect is {"desc": "<specific, names the element>", "severity": 1-5 (5 = ruins the page), "category": "missing-content"|"wrong-style"|"layout-broken"|"text-junk"|"imagery-missing"|"chrome-missing"}.
Be strict: missing logos/icons/images, unstyled buttons or pills, text rendered as junk/stacked fragments, flattened inline code, dead UI mockups (missing window dots/tabs/syntax colors), overflowing or misaligned layout ALL count.
If both sides are empty or identical, score 100 with zero defects. Dark-gray padding at the bottom of one side only reflects a page-height mismatch — judge the painted content.
Output ONLY this JSON, no prose, no markdown fences: {"score": <0-100>, "defects": [{"desc": "...", "severity": <1-5>, "category": "..."}]}`;
function extractJson(t){if(!t)return null;try{return JSON.parse(t)}catch{}const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a<0||b<=a)return null;try{return JSON.parse(t.slice(a,b+1))}catch{return null}}
function once(prompt,cwd){return new Promise(res=>{execFile('claude',['-p',prompt,'--model',MODEL,'--output-format','json','--allowedTools','Read','--max-budget-usd','0.60'],{timeout:300000,maxBuffer:16*1024*1024,cwd},(err,stdout)=>{if(err&&!stdout)return res({ok:false,error:String(err.message||err)});let o=null;try{o=JSON.parse(stdout)}catch{}if(!o)return res({ok:false,error:'outer-parse'});const v=extractJson(o.result);if(!v||typeof v.score!=='number'||!Array.isArray(v.defects))return res({ok:false,error:'verdict-invalid',raw:String(o.result).slice(0,300)});res({ok:true,score:v.score,defects:v.defects,cost:+o.total_cost_usd||0})});});}
const T=(p,y0,id)=>({p,y0,y1:y0+900,id});
const jobs=[
  T('/private/tmp/vj-tailwind/w1440-tile-00.png',0,'rep-tw00-a'),T('/private/tmp/vj-tailwind/w1440-tile-00.png',0,'rep-tw00-b'),
  T('/private/tmp/vj-tailwind/w1440-tile-01.png',900,'rep-tw01-a'),T('/private/tmp/vj-tailwind/w1440-tile-01.png',900,'rep-tw01-b'),
  T('/private/tmp/vj-tailwind/w1440-tile-02.png',1800,'rep-tw02-a'),T('/private/tmp/vj-tailwind/w1440-tile-02.png',1800,'rep-tw02-b'),
  T('/private/tmp/vj-tailwind/w1440-tile-03.png',2700,'rep-tw03-a'),T('/private/tmp/vj-tailwind/w1440-tile-03.png',2700,'rep-tw03-b'),
  T('/private/tmp/vj-tailwind/w1440-tile-04.png',3600,'rep-tw04-a'),T('/private/tmp/vj-tailwind/w1440-tile-04.png',3600,'rep-tw04-b'),
  T('/private/tmp/vj-supabase/w1440-tile-02.png',1800,'honesty-sb02'),
  T('/tmp/vj-critic/ctrl-identical.png',1800,'ctrl-identical'),
  T('/tmp/vj-critic/ctrl-swap.png',1800,'ctrl-swap'),
];
const results={};let next=0;
await Promise.all([1,2,3].map(async()=>{while(next<jobs.length){const j=jobs[next++];const r=await once(RUBRIC(j.p,1440,j.y0,j.y1),'/tmp/vj-critic');results[j.id]=r;console.error(j.id,r.ok?`score=${r.score} defects=${r.defects.length}`:`FAIL ${r.error}`);fs.writeFileSync('/tmp/vj-critic/critic-results.json',JSON.stringify(results,null,2));}}));
console.log('DONE');
