import { Store } from '../storage/index.ts';
import { inspectRsssf } from './rsssf.ts';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const store=new Store();
try{for(const slug of ['cronaldo','messi']){
  const url=`https://www.rsssf.org/miscellaneous/${slug}-intlg.html`;
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error(`RSSSF HTTP ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  const originalHash=store.preserve(bytes);
  let html:string;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{html=new TextDecoder('windows-1252').decode(bytes);}
  const report=inspectRsssf(html,url,store);report.documentHash=originalHash;
  const path=join(store.root,'reports',`rsssf-${slug}.json`);writeFileSync(path,JSON.stringify({...report,originalHash},null,2));
  console.log(`${slug}: ${report.matchRecords.length} candidate matches, ${report.issues.length} issues. ${path}`);
}}catch(e){console.error((e as Error).message);process.exitCode=1;}finally{store.close();}
