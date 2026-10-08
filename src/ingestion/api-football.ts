import { Store } from '../storage/index.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
type Fetcher=typeof fetch;
export interface ProviderConfig { players: {canonicalId:string; providerId:number; league:number; season:number}[] }
export class FootballProvider {
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private store:Store,private key=process.env.API_FOOTBALL_KEY??'',private fetcher:Fetcher=fetch,private now=()=>new Date(),private pause=(ms:number)=>new Promise(r=>setTimeout(r,ms))){}
  status(){
    const day=this.now().toISOString().slice(0,10),used=(this.store.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE day=?').get(day) as {n:number}).n;
    const success=this.store.getState('provider_success')??null;
    return {configured:!!this.key,used,limit:80,remaining:Math.max(0,80-used),resetAt:`${new Date(Date.parse(day)+86400000).toISOString()}`,lastSuccess:success,lastError:this.store.getState('provider_error')??null,stale:!success||this.now().getTime()-Date.parse(success)>12*3600000,configPresent:existsSync(join(this.store.root,'provider.json'))};
  }
  request(endpoint:string,params:Record<string,string|number>={},ttl=0):Promise<any>{
    const task=this.queue.then(()=>this.perform(endpoint,params,ttl));this.queue=task.catch(()=>{});return task;
  }
  private async perform(endpoint:string,params:Record<string,string|number>,ttl:number){
    if(!['leagues','players','fixtures'].includes(endpoint))throw new Error('Unsupported provider endpoint');
    if(!this.key)throw new Error('API-Football key is not configured');
    const query=new URLSearchParams(Object.entries(params).sort().map(([k,v])=>[k,String(v)])),cacheKey=`${endpoint}?${query}`;
    const cached=this.store.db.prepare('SELECT payload,at FROM cache WHERE key=?').get(cacheKey) as {payload:string;at:string}|undefined;
    if(cached&&this.now().getTime()-Date.parse(cached.at)<ttl)return JSON.parse(cached.payload);
    for(let attempt=0;attempt<3;attempt++){
      const day=this.now().toISOString().slice(0,10);
      if(this.store.getState('provider_blocked_day')===day)throw new Error('Provider daily quota exhausted');
      this.store.db.exec('BEGIN IMMEDIATE');
      try{
        const used=(this.store.db.prepare('SELECT COUNT(*) AS n FROM requests WHERE day=?').get(day) as {n:number}).n;
        if(used>=80)throw new Error('Local daily request budget exhausted');
        this.store.db.prepare('INSERT INTO requests(day,endpoint,at) VALUES (?,?,?)').run(day,endpoint,this.now().toISOString());this.store.db.exec('COMMIT');
      }catch(e){this.store.db.exec('ROLLBACK');throw e;}
      const next=Number(this.store.getState('provider_next_at')??0);
      if(next>this.now().getTime())await this.pause(next-this.now().getTime());
      this.store.setState('provider_next_at',String(this.now().getTime()+6500));
      let response:Response;
      try{response=await this.fetcher(`https://v3.football.api-sports.io/${cacheKey}`,{headers:{'x-apisports-key':this.key},signal:AbortSignal.timeout(20000)});}
      catch{if(attempt<2){await this.pause(1000*2**attempt);continue;}throw new Error('Provider network request failed');}
      const remaining=response.headers.get('x-ratelimit-requests-remaining');
      if(remaining!==null&&Number(remaining)<=0)this.store.setState('provider_blocked_day',day);
      if(response.status===429){this.store.setState('provider_next_at',String(this.now().getTime()+Math.max(60,Number(response.headers.get('retry-after'))||60)*1000));throw new Error('Provider rate limit reached; refresh paused');}
      if(response.status===401||response.status===403)throw new Error('Provider authentication or season entitlement denied');
      if(response.status>=500&&attempt<2){await this.pause(1000*2**attempt);continue;}
      if(!response.ok)throw new Error(`Provider HTTP ${response.status}`);
      const raw=await response.text();this.store.preserve(raw);
      let body:any;try{body=JSON.parse(raw);}catch{throw new Error('Provider returned invalid JSON');}
      if(body.errors&&Object.keys(body.errors).length)throw new Error('Provider rejected request: check season entitlement, parameters, or quota in the provider dashboard');
      if(!Array.isArray(body.response))throw new Error('Provider response schema changed');
      if(response.headers.get('x-ratelimit-remaining')==='0')this.store.setState('provider_next_at',String(this.now().getTime()+60000));
      const result={...body,evidenceHash:this.store.preserve(raw),retrievedAt:this.now().toISOString()};
      this.store.db.prepare('INSERT INTO cache VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,at=excluded.at').run(cacheKey,JSON.stringify(result),this.now().toISOString());
      return result;
    }
    throw new Error('Provider refresh failed');
  }
  async refresh(){
    try{
      const file=join(this.store.root,'provider.json');if(!existsSync(file))throw new Error('Configure runtime/provider.json with reviewed player, league and season IDs first');
      const config=JSON.parse(readFileSync(file,'utf8')) as ProviderConfig;
      if(!Array.isArray(config.players)||config.players.length!==2||new Set(config.players.map(p=>p.canonicalId)).size!==2||config.players.some(p=>!['cristiano_ronaldo','lionel_messi'].includes(p.canonicalId)||![p.providerId,p.league,p.season].every(n=>Number.isSafeInteger(n)&&n>0)))throw new Error('Invalid provider mapping configuration');
      const imports=[];
      for(const p of config.players){
        const leagues=await this.request('leagues',{id:p.league},7*86400000);
        const season=leagues.response.flatMap((l:any)=>l.seasons??[]).find((s:any)=>s.year===p.season);
        if(!season||!season.current||!season.coverage?.players)throw new Error('Required current season or player-stat coverage is unavailable');
        const pages=[];let total=1;
        for(let page=1;page<=total;page++){
          const body=await this.request('players',{id:p.providerId,league:p.league,season:p.season,page},12*3600000);
          if(!Number.isInteger(body.paging?.total)||body.paging.total<1||body.paging.total>80||body.paging.current!==page)throw new Error('Incomplete or invalid provider pagination');
          total=body.paging.total;
          if(!body.response.length||body.response.some((v:any)=>v.player?.id!==p.providerId))throw new Error('Player identity or season access could not be verified');
          pages.push(body);
        }
        imports.push({mapping:p,pages});
      }
      const report={status:'review_required',freshness:'B1',createdAt:this.now().toISOString(),imports,message:'Review identity, scope and completeness before canonical publication. Existing snapshots are unchanged.'};
      const path=join(this.store.root,'reports',`api-football-${this.now().getTime()}.json`);writeFileSync(path,JSON.stringify(report,null,2));
      this.store.setState('provider_success',this.now().toISOString());this.store.setState('provider_error','');return {status:report.status,message:report.message};
    }catch(e){const message=e instanceof Error?e.message:'Provider refresh failed';this.store.setState('provider_error',message);throw new Error(message);}
  }
}
