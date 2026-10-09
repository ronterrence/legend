import express from 'express';
import { createServer as createViteServer } from 'vite';
import { chromium } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { Store } from '../storage/index.ts';
import { seedDemo } from '../ingestion/demo.ts';
import { FootballProvider } from '../ingestion/api-football.ts';
const store=new Store();seedDemo(store);
const provider=new FootballProvider(store),app=express(),port=Number(process.env.PORT??4317);
const origin=`http://127.0.0.1:${port}`;
app.disable('x-powered-by');app.use(express.json({limit:'128kb'}));
app.use((req,res,next)=>{
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(req.headers.host??'')){res.status(403).json({error:'Local host required'});return;}
  if(req.method!=='GET'&&req.method!=='HEAD'){
    if(![origin,`http://localhost:${port}`].includes(req.headers.origin??'')||!req.is('application/json')){res.status(403).json({error:'Same-origin JSON request required'});return;}
  }next();
});
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.get('/api/snapshots',(_req,res)=>res.json(store.listSnapshots().map(s=>({id:s.id,label:s.label,kind:s.kind,freshness:s.freshness,cutoffAt:s.manifest.cutoffAt,players:s.players}))));
app.get('/api/players',(_req,res)=>res.json(store.listSnapshots()[0]?.players??[]));
app.get('/api/comparisons',(_req,res)=>res.json(store.listComparisons()));
app.post('/api/comparisons',(req,res)=>{
  const b=req.body;if(!b||Object.keys(b).some(k=>!['snapshotId','snapshotAlias','playerIds'].includes(k)))throw new Error('Invalid comparison request');
  if((b.snapshotId!==undefined&&typeof b.snapshotId!=='string')||(b.snapshotAlias!==undefined&&typeof b.snapshotAlias!=='string')||(b.playerIds!==undefined&&(!Array.isArray(b.playerIds)||b.playerIds.some((p:unknown)=>typeof p!=='string'))))throw new Error('Invalid comparison field types');
  res.json(store.compare({snapshotId:b.snapshotId,snapshotAlias:b.snapshotAlias},b.playerIds));
});
app.get('/api/comparisons/:id',(req,res)=>res.json(store.comparison(req.params.id)));
app.get('/api/provider',(_req,res)=>res.json(provider.status()));
let refreshing=false;
async function refresh(){if(refreshing)throw new Error('Refresh already running');refreshing=true;try{return await provider.refresh();}finally{refreshing=false;}}
app.post('/api/provider/refresh',async(_req,res)=>res.json(await refresh()));
const timer=setInterval(()=>{const status=provider.status();if(status.configured&&status.configPresent&&status.stale&&!refreshing)void refresh().catch(()=>{});},12*3600000);timer.unref();
const exportsInFlight=new Map<string,Promise<void>>();
app.post('/api/comparisons/:id/export',async(req,res)=>{
  const {page,theme,resolution}=req.body??{};
  if(Object.keys(req.body??{}).some(key=>!['page','theme','resolution'].includes(key)))throw new Error('Invalid export option');
  if(!['overview','efficiency','international'].includes(page))throw new Error('Invalid export page');
  if(theme!=='legend')throw new Error('Unsupported export theme');
  if(!['1080','4k'].includes(resolution))throw new Error('Invalid export resolution');
  const d=store.comparison(req.params.id),key=`${d.id}-${page}-${theme}-${resolution}`,file=join(store.root,'exports',`${key}.png`),metadata=join(store.root,'exports',`${key}.json`);
  if(!existsSync(file)){
    let job=exportsInFlight.get(key);
    if(!job){job=(async()=>{const browser=await chromium.launch({headless:true});try{const tab=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:resolution==='4k'?2:1});await tab.goto(`${origin}/?export=${d.id}&page=${page}&theme=${theme}`);await tab.locator('[data-export-ready="true"]').waitFor();await tab.evaluate(()=>document.fonts.ready);const buffer=await tab.locator('.dashboard').screenshot({animations:'disabled',caret:'hide'});const dimensions=resolution==='4k'?{width:2160,height:3840}:{width:1080,height:1920};const evidenceState=d.kind==='demo'?'synthetic_demo':'verified';writeFileSync(metadata,JSON.stringify({comparison_id:d.id,snapshot_id:d.snapshotId,sporting_cutoff:d.cutoffAt,module:page,evidence_state:evidenceState,product_branding:'THE LEGEND DASHBOARD',theme,template_version:'legend-poster-v1',renderer_version:d.rendererVersion,resolution,dimensions,dashboard:d},null,2));writeFileSync(file,buffer);}finally{await browser.close();}})();exportsInFlight.set(key,job);}
    try{await job;}finally{exportsInFlight.delete(key);}
  }
  res.json({png:`/api/exports/${key}.png`,metadata:`/api/exports/${key}.json`});
});
app.get('/api/exports/:file',(req,res)=>{
  if(!/^[a-f0-9-]+-(overview|efficiency|international)-legend-(1080|4k)\.(png|json)$/.test(req.params.file)){res.status(400).end();return;}
  const path=join(store.root,'exports',req.params.file);if(!existsSync(path)){res.status(404).end();return;}res.download(path);
});
app.use('/api',(_req,res)=>res.status(404).json({error:'Unknown API route'}));
app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>res.status(400).json({error:err.message.includes('browserType.launch')?'Export browser is not installed. Run npx playwright install chromium.':err.message}));
if(process.argv.includes('--production')){app.use(express.static(resolve('dist')));app.use((_req,res)=>res.sendFile(resolve('dist/index.html')));}
else{const vite=await createViteServer({server:{middlewareMode:true},appType:'spa'});app.use(vite.middlewares);}
const server=app.listen(port,'127.0.0.1',()=>console.log(`Legend studio: ${origin}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{clearInterval(timer);server.close(()=>{store.close();process.exit(0);});});
