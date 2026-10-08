import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import snapshotSchema from '../../schemas/snapshot.schema.json';
import dashboardSchema from '../../schemas/dashboard.schema.json';
import coverageSchema from '../../schemas/coverage.schema.json';
import playerSchema from '../../schemas/player.schema.json';
import provenanceSchema from '../../schemas/provenance.schema.json';
import metricSchema from '../../schemas/metric.schema.json';
import internationalSchema from '../../schemas/international.schema.json';
import type { Snapshot, Dashboard } from '../domain.ts';
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
ajv.addSchema(coverageSchema,'coverage.schema.json');ajv.addSchema(playerSchema,'player.schema.json');ajv.addSchema(provenanceSchema,'provenance.schema.json');ajv.addSchema(metricSchema,'metric.schema.json');ajv.addSchema(internationalSchema,'international.schema.json');
const validate = ajv.compile<Snapshot>(snapshotSchema);
const validateOutput=ajv.compile<Dashboard>(dashboardSchema);
export function validateDashboard(input:unknown):asserts input is Dashboard {if(!validateOutput(input))throw new Error(`Dashboard schema validation failed: ${ajv.errorsText(validateOutput.errors)}`);}
export function validateSnapshot(input: unknown): asserts input is Snapshot {
  if (!validate(input)) throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
  const s = input;
  const unique = (values: string[], label: string) => { if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label}`); };
  unique(s.players.map(p=>p.id), 'player'); unique(s.sources.map(p=>p.id), 'source');
  unique(s.observations.map(o=>`${o.playerId}:${o.metric}:${o.category??'overall'}`), 'observation; reconcile conflicts before publication');
  if (!s.manifest.validated) throw new Error('Coverage manifest requires validation');
  if (Date.parse(s.manifest.cutoffAt) > Date.parse(s.publishedAt)) throw new Error('Cutoff must not follow publication');
  if (s.freshness === 'B0' && (s.manifest.policy !== 'completed_editions' || s.manifest.editions.some(e=>e.status !== 'completed'))) throw new Error('B0 requires completed editions');
  if (s.freshness === 'B1' && s.manifest.policy !== 'current_season') throw new Error('B1 requires current-season coverage');
  if (s.kind === 'verified' && s.sources.some(x=>x.provider === 'fixture')) throw new Error('Synthetic evidence cannot become verified');
  if(s.kind==='verified')for(const e of s.manifest.editions){
    if(!e.startAt||!e.endAt||!e.matchSetHash)throw new Error('Verified coverage requires edition boundaries and preserved match-set evidence');
    if(Date.parse(e.startAt)>Date.parse(e.endAt)||Date.parse(e.endAt)>=Date.parse(s.manifest.cutoffAt))throw new Error('Edition boundaries exceed shared exclusive cutoff');
  }
  for (const o of s.observations) {
    if (!s.players.some(p=>p.id===o.playerId) || o.sourceIds.some(id=>!s.sources.some(x=>x.id===id))) throw new Error('Unknown player or source reference');
    if (o.review !== 'accepted') throw new Error('Observations require accepted review');
    if (o.scopeId !== s.manifest.scopeId || !s.manifest.editions.some(e=>e.matchSetId === o.matchSetId)) throw new Error('Observation coverage not in manifest');
    if (o.value !== null && (!Number.isFinite(o.value) || (o.metric !== 'minutes' && !Number.isSafeInteger(o.value)))) throw new Error('Counts must be safe integers');
  }
  for (const p of s.players) {
    const obs=s.observations.filter(o=>o.playerId===p.id), goals=obs.find(o=>o.metric==='goals'), penalties=obs.find(o=>o.metric==='penalty_goals');
    if (goals?.value != null && penalties?.value != null && goals.matchSetId===penalties.matchSetId && penalties.value > goals.value) throw new Error('Penalty goals exceed goals');
  }
}
