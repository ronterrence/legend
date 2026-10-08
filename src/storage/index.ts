import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Snapshot, Dashboard } from '../domain.ts';
import { validateSnapshot, validateDashboard } from '../validation/index.ts';
import { assemble } from '../metrics/index.ts';
export const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex');
export class Store {
  db:DatabaseSync; root:string;
  constructor(root=process.env.LEGEND_DATA_DIR??'runtime'){
    this.root=resolve(root);for(const dir of ['', 'sources','exports','reports'])mkdirSync(join(this.root,dir),{recursive:true});
    this.db=new DatabaseSync(join(this.root,'legend.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS aliases(name TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES snapshots(id));
      CREATE TABLE IF NOT EXISTS comparisons(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, day TEXT NOT NULL, endpoint TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cache(key TEXT PRIMARY KEY, payload TEXT NOT NULL, at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  preserve(data:string|Buffer){const digest=hash(data),file=join(this.root,'sources',digest);if(!existsSync(file))writeFileSync(file,data);return digest;}
  publish(input:unknown,alias?:string){
    validateSnapshot(input);const s=input;
    for(const source of s.sources){const file=join(this.root,'sources',source.documentHash);if(!existsSync(file)||hash(readFileSync(file))!==source.documentHash)throw new Error(`Missing or altered source evidence: ${source.id}`);}
    if(s.kind==='verified')for(const edition of s.manifest.editions){const file=join(this.root,'sources',edition.matchSetHash!);if(!existsSync(file)||hash(readFileSync(file))!==edition.matchSetHash)throw new Error('Missing match-set evidence');const matches=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(matches)||!matches.length||matches.some(m=>!m.id||!m.finishedAt||!Number.isFinite(Date.parse(m.finishedAt))||Date.parse(m.finishedAt)<Date.parse(edition.startAt!)||Date.parse(m.finishedAt)>Date.parse(edition.endAt!))||new Set(matches.map(m=>m.id)).size!==matches.length)throw new Error('Invalid preserved match set');}
      const payload=JSON.stringify(s);let existing:{payload:string}|undefined;
      this.db.exec('BEGIN IMMEDIATE');try{
        existing=this.db.prepare('SELECT payload FROM snapshots WHERE id=?').get(s.id) as {payload:string}|undefined;
        if(existing&&existing.payload!==payload)throw new Error('Immutable snapshot ID already exists with different content');
        if(s.supersedes){if(s.supersedes===s.id)throw new Error('Snapshot cannot supersede itself');if(!this.db.prepare('SELECT 1 FROM snapshots WHERE id=?').get(s.supersedes))throw new Error('Superseded snapshot does not exist');}
      this.db.prepare('INSERT OR IGNORE INTO snapshots VALUES (?,?)').run(s.id,payload);
      if(alias)this.db.prepare('INSERT INTO aliases VALUES (?,?) ON CONFLICT(name) DO UPDATE SET snapshot_id=excluded.snapshot_id').run(alias,s.id);
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return {id:s.id,duplicate:!!existing};
  }
  snapshot(id:string):Snapshot{const row=this.db.prepare('SELECT payload FROM snapshots WHERE id=?').get(id) as {payload:string}|undefined;if(!row)throw new Error('Unknown snapshot');return JSON.parse(row.payload);}
  resolve(selector:{snapshotId?:string;snapshotAlias?:string}){
    if(Number(!!selector.snapshotId)+Number(!!selector.snapshotAlias)!==1)throw new Error('Provide exactly one snapshot ID or alias');
    const row=selector.snapshotAlias?this.db.prepare('SELECT snapshot_id FROM aliases WHERE name=?').get(selector.snapshotAlias) as {snapshot_id:string}|undefined:undefined;
    return this.snapshot(selector.snapshotId??row?.snapshot_id??'');
  }
  listSnapshots(){return (this.db.prepare('SELECT payload FROM snapshots ORDER BY rowid DESC').all() as {payload:string}[]).map(x=>JSON.parse(x.payload) as Snapshot);}
  compare(selector:{snapshotId?:string;snapshotAlias?:string},playerIds?:string[]){
    const s=structuredClone(this.resolve(selector));
    if(playerIds){if(playerIds.length!==2||new Set(playerIds).size!==2||playerIds.some(id=>!s.players.some(p=>p.id===id)))throw new Error('Select two distinct players in this snapshot');s.players=playerIds.map(id=>s.players.find(p=>p.id===id)!);}
    const d=assemble(s,randomUUID());validateDashboard(d);this.db.prepare('INSERT INTO comparisons VALUES (?,?)').run(d.id,JSON.stringify(d));return d;
  }
  comparison(id:string):Dashboard{const row=this.db.prepare('SELECT payload FROM comparisons WHERE id=?').get(id) as {payload:string}|undefined;if(!row)throw new Error('Unknown comparison');return JSON.parse(row.payload);}
  listComparisons(){return (this.db.prepare('SELECT payload FROM comparisons ORDER BY rowid DESC LIMIT 50').all() as {payload:string}[]).map(x=>JSON.parse(x.payload) as Dashboard);}
  getState(key:string){const r=this.db.prepare('SELECT value FROM state WHERE key=?').get(key) as {value:string}|undefined;return r?.value;}
  setState(key:string,value:string){this.db.prepare('INSERT INTO state VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
  close(){this.db.close();}
}
