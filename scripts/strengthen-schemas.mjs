import {readFileSync,writeFileSync} from 'node:fs';
for(const path of ['schemas/dashboard/coverage.schema.json','schemas/dashboard/snapshot.schema.json']){
  const schema=JSON.parse(readFileSync(path,'utf8'));
  const manifest=path.includes('snapshot')?schema.properties.manifest:schema;
  Object.assign(manifest.properties.editions.items.properties,{
    startAt:{type:'string',format:'date-time'},endAt:{type:'string',format:'date-time'},
    matchSetHash:{type:'string',pattern:'^[a-f0-9]{64}$'}
  });
  writeFileSync(path,JSON.stringify(schema,null,2)+'\n');
}
