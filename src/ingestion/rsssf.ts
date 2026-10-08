import { load } from 'cheerio';
import { Store } from '../storage/index.ts';
export function inspectRsssf(html:string,url:string,store:Store){
  const parsed=new URL(url);if(!['rsssf.org','www.rsssf.org'].includes(parsed.hostname)||parsed.protocol!=='https:')throw new Error('RSSSF HTTPS source required');
  const $=load(html),title=$('h1,h2,title').first().text().trim();
  const pre=$('pre').text();
  const documentHash=store.preserve(html);
  if(!pre.trim())throw new Error('Unsupported RSSSF page layout: expected a preformatted record; evidence preserved for review');
  // Candidate lines retain their original text; numerical interpretation needs a page-specific review.
  const lines=pre.split(/\r?\n/).map(x=>x.trimEnd()).filter(Boolean);
  if(!lines.some(x=>/\d/.test(x)))throw new Error('No record rows found; review source layout');
  const matchRecords: {cap:number;goals:number;cumulativeGoals:number;date:string;competition:string;raw:string}[]=[];
  const issues:string[]=[];
  const identities:Record<string,string>={'/miscellaneous/cronaldo-intlg.html':'cristiano_ronaldo','/miscellaneous/messi-intlg.html':'lionel_messi'};
  const playerId=identities[parsed.pathname];
  if(playerId){
    if(!/Cap\s+Goals\s+Date/.test(pre))throw new Error('International caps table header changed');
    for(const raw of lines){
      const date=/\b(\d{1,2})-\s*(\d{1,2})-(\d{2})\b/.exec(raw);if(!date)continue;
      const prefix=raw.slice(0,date.index).trim();if(!/^\d+(?:\s+\d+){0,2}$/.test(prefix))continue;
      const fields=prefix.split(/\s+/).map(Number),cap=fields[0],goals=fields.length===3?fields[1]:0,cumulativeGoals=fields.length>1?fields.at(-1)!:0;
      const year=Number(date[3])+(Number(date[3])>=70?1900:2000),iso=`${year}-${date[2].padStart(2,'0')}-${date[1].padStart(2,'0')}`;
      const rest=raw.slice(date.index+date[0].length),score=/\d+\s*-\s*\d+(?:\s*\[\d+\])?\s*(.*)$/.exec(rest);
      if(!score){issues.push(`Cap ${cap}: unrecognized score`);continue;}
      if(cap!==matchRecords.length+1)issues.push(`Cap ${cap}: non-contiguous appearance sequence`);
      if((matchRecords.at(-1)?.cumulativeGoals??0)+goals!==cumulativeGoals)issues.push(`Cap ${cap}: cumulative goals disagree with match goals`);
      if(matchRecords.at(-1)&&iso<matchRecords.at(-1)!.date)issues.push(`Cap ${cap}: date order conflict`);
      matchRecords.push({cap,goals,cumulativeGoals,date:iso,competition:score[1].trim()||'Friendly',raw});
    }
    if(!matchRecords.length)throw new Error('Supported source contains no parsable international match records');
  }
  return {provider:'rsssf',url,title,documentHash,retrievedAt:new Date().toISOString(),status:'review_required',playerId,matchRecords,issues,lines,observations:[],message:'Candidate records only. Resolve reported conflicts and map completed competition editions before canonical publication; no automatic career totals.'};
}
