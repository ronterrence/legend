import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Store } from './storage/index.ts';
import { seedDemo } from './ingestion/demo.ts';
import { inspectRsssf } from './ingestion/rsssf.ts';
import { FootballProvider } from './ingestion/api-football.ts';
import { validateSnapshot } from './validation/index.ts';
import { assemble } from './metrics/index.ts';
const store=new Store();
try{
  const [command,file,url]=process.argv.slice(2);
  if(command==='validate'){seedDemo(store);for(const s of store.listSnapshots()){validateSnapshot(s);const d=assemble(s,'check'),rows=[...d.pages.overview,...d.pages.efficiency,...d.pages.international.flatMap(g=>g.rows)];for(const row of rows)for(const v of [row.left,row.right])if(v.status==='available'&&!v.sourceIds.length)throw new Error('Metric missing provenance');}console.log('Schema validation and metric consistency checks passed.');}
  else if(command==='import'){
    if(!file)throw new Error('Usage: npm run import -- path/to/bundle.json');
    const bundle=JSON.parse(readFileSync(file,'utf8'));
    if(!Array.isArray(bundle.evidence))throw new Error('Import bundle requires evidence [{path, hash}] and snapshot');
    for(const e of bundle.evidence){const data=readFileSync(resolve(dirname(file),e.path));if(store.preserve(data)!==e.hash)throw new Error('Evidence hash does not match bundle');}
    console.log(store.publish(bundle.snapshot,bundle.alias));
  }else if(command==='rsssf'){
    if(!file||!url)throw new Error('Usage: npm run inspect:rsssf -- source.html https://www.rsssf.org/...');
    const report=inspectRsssf(readFileSync(file,'utf8'),url,store),path=join(store.root,'reports',`rsssf-${report.documentHash}.json`);writeFileSync(path,JSON.stringify(report,null,2));console.log(path);
  }else if(command==='provider'){console.log(await new FootballProvider(store).refresh());}
  else throw new Error('Commands: validate, import, rsssf, provider');
}catch(e){console.error(e instanceof Error?e.message:'Command failed');process.exitCode=1;}finally{store.close();}
