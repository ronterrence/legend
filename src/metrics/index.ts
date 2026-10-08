import type { Dashboard, InternationalCategory, MetricId, MetricRow, MetricValue, Observation, Snapshot } from '../domain.ts';
export const definitions: {id:string;label:string;inputs:MetricId[];formula:string;unit:string;precision:number;direction:'higher'|'lower';page:'overview'|'efficiency'}[] = [
  ...(['appearances','goals','assists','club_trophies','international_trophies','awards'] as MetricId[]).map(id=>({id,label:({appearances:'Appearances',goals:'Goals',assists:'Assists',club_trophies:'Major club trophies',international_trophies:'International trophies',awards:'Individual awards'} as Record<string,string>)[id],inputs:[id],formula:'Verified count within declared coverage',unit:'',precision:0,direction:'higher' as const,page:'overview' as const})),
  {id:'goals_per_game',label:'Goals per game',inputs:['goals','appearances'],formula:'Goals ÷ appearances',unit:'per game',precision:2,direction:'higher',page:'efficiency'},
  {id:'contributions_per_game',label:'Goal contributions',inputs:['goals','assists','appearances'],formula:'(Goals + assists) ÷ appearances',unit:'per game',precision:2,direction:'higher',page:'efficiency'},
  {id:'non_penalty_per_game',label:'Non-penalty goals',inputs:['goals','penalty_goals','appearances'],formula:'(Goals − penalty goals) ÷ appearances',unit:'per game',precision:2,direction:'higher',page:'efficiency'},
  {id:'minutes_per_goal',label:'Minutes per goal',inputs:['minutes','goals'],formula:'Minutes played ÷ goals',unit:'minutes',precision:1,direction:'lower',page:'efficiency'}
];
export function formatRatio(n: bigint, d: bigint, precision: number): string {
  const scale=10n**BigInt(precision), rounded=(n*scale*2n+d)/(2n*d);
  const text=rounded.toString().padStart(precision+1,'0');
  return precision ? `${text.slice(0,-precision)}.${text.slice(-precision)}` : text;
}
function decimal(n:number): [bigint,bigint] {
  const [base,exp='0']=n.toString().toLowerCase().split('e');
  const parts=base.split('.'), shift=Number(exp)-(parts[1]?.length??0);
  return shift>=0 ? [BigInt(parts.join(''))*10n**BigInt(shift),1n] : [BigInt(parts.join('')),10n**BigInt(-shift)];
}
export function calculate(id:string, obs:Observation[], category:InternationalCategory='overall'):MetricValue {
  const def=definitions.find(x=>x.id===id)!;
  const scoped=obs.filter(o=>(o.category??'overall')===category);
  const inputs=def.inputs.map(m=>scoped.find(o=>o.metric===m));
  const sourceIds=[...new Set(inputs.flatMap(x=>x?.sourceIds??[]))];
  const fail=(status:MetricValue['status'],reason:string):MetricValue=>({value:null,display:'N/A',status,reason,sourceIds});
  if(inputs.some(o=>o?.value!=null&&(!Number.isFinite(o.value)||o.value<0)))return fail('invalid','invalid_input');
  if(inputs.some(o=>!o||o.value===null))return fail('unavailable','missing_input');
  const vals=inputs as Observation[];
  if(vals.some(o=>o.review!=='accepted'))return fail('unavailable','unreviewed_input');
  if(vals.some(o=>o.coverage!=='complete'))return fail('unavailable','partial_coverage');
  if(new Set(vals.map(o=>`${o.scopeId}:${o.matchSetId}`)).size!==1)return fail('invalid','incompatible_scope');
  const v=(m:MetricId)=>scoped.find(o=>o.metric===m)!.value!;
  let n:bigint,d=1n;
  if(def.inputs.length===1)n=BigInt(v(def.inputs[0]));
  else if(id==='minutes_per_goal'){const [a,b]=decimal(v('minutes'));n=a;d=b*BigInt(v('goals'));}
  else {n=BigInt(v('goals'));d=BigInt(v('appearances'));if(id==='contributions_per_game')n+=BigInt(v('assists'));if(id==='non_penalty_per_game')n-=BigInt(v('penalty_goals'));}
  if(n<0n)return fail('invalid','penalties_exceed_goals');
  if(d===0n)return fail('undefined','zero_denominator');
  return {value:{numerator:String(n),denominator:String(d)},display:formatRatio(n,d,def.precision),status:'available',reason:null,sourceIds};
}
export function assemble(s:Snapshot,id:string,createdAt=new Date().toISOString()):Dashboard {
  const pages:Dashboard['pages']={overview:[],efficiency:[],international:[]};
  for(const def of definitions){
    const [left,right]=s.players.map(p=>calculate(def.id,s.observations.filter(o=>o.playerId===p.id)));
    let leader:MetricRow['leader']=null,comparison='Not comparable';
    if(left.value&&right.value){
      const diff=BigInt(left.value.numerator)*BigInt(right.value.denominator)-BigInt(right.value.numerator)*BigInt(left.value.denominator);
      comparison=diff===0n?'Exact tie':left.display===right.display?'Equal at displayed precision':'Comparable within coverage';
      if(diff!==0n&&left.display!==right.display)leader=(diff>0n)===(def.direction==='higher')?'left':'right';
    }
    pages[def.page].push({id:def.id,label:def.label,formula:def.formula,unit:def.unit,direction:def.direction,left,right,leader,comparison});
  }
  const groups: {id:InternationalCategory;label:string;description:string}[]=[
    {id:'overall',label:'Overall',description:'All covered senior international matches'},
    {id:'friendly',label:'Friendlies',description:'Recognized senior international friendlies'},
    {id:'world_cup',label:'World Cup',description:'World Cup finals matches'},
    {id:'continental',label:'Continental championship',description:'European Championship and Copa América finals'},
    {id:'qualifier',label:'Qualifiers',description:'World Cup and continental qualifiers'},
    {id:'other',label:'Other',description:'Other covered senior international competitions'}
  ];
  const internationalDefinitions=definitions.filter(d=>d.id==='appearances'||d.id==='goals'||d.id==='goals_per_game');
  pages.international=groups.map(group=>({id:group.id,label:group.label,description:group.description,rows:internationalDefinitions.map(def=>{
    const [left,right]=s.players.map(p=>calculate(def.id,s.observations.filter(o=>o.playerId===p.id),group.id));
    let leader:MetricRow['leader']=null,comparison='Not comparable';
    if(left.value&&right.value){const diff=BigInt(left.value.numerator)*BigInt(right.value.denominator)-BigInt(right.value.numerator)*BigInt(left.value.denominator);comparison=diff===0n?'Exact tie':left.display===right.display?'Equal at displayed precision':'Comparable within coverage';if(diff!==0n&&left.display!==right.display)leader=(diff>0n)===(def.direction==='higher')?'left':'right';}
    return {id:`international_${group.id}_${def.id}`,label:def.label,formula:def.formula,unit:def.unit,direction:def.direction,left,right,leader,comparison};
  })}));
  return {id,createdAt,snapshotId:s.id,label:s.label,freshness:s.freshness,kind:s.kind,scopeId:s.manifest.scopeId,cutoffAt:s.manifest.cutoffAt,coverage:s.manifest,definitionVersion:'v1',rendererVersion:'v1',players:s.players,sources:s.sources,pages,narrative:'A comparison is only as complete as its evidence. Explore the definitions and coverage behind every number.'};
}
