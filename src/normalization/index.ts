export function parseCount(text:string):number|null {
  const clean=text.trim();if(!clean||/^(?:-|–|—|n\/a|\?)$/i.test(clean))return null;
  if(!/^\d+(?:[,.]\d{3})*$/.test(clean))throw new Error(`Ambiguous count: ${text}`);
  return Number(clean.replace(/[,.]/g,''));
}
export function reconcile<T>(candidates:T[],selected:number,reason:string):{selected:T;reason:string}{
  if(!reason.trim()||!Number.isInteger(selected)||selected<0||selected>=candidates.length)throw new Error('Explicit selection and reconciliation reason required');
  return {selected:candidates[selected],reason};
}
