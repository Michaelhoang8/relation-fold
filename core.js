// Bitsets make exhaustive implication checks practical for bounded schemas.
export const example = {
  attributes: 'Order, Product, Customer, City, Price, Quantity',
  dependencies: 'Order -> Customer\nCustomer -> City\nProduct -> Price\nOrder, Product -> Quantity',
  decomposition: 'Order, Customer\nCustomer, City\nProduct, Price\nOrder, Product, Quantity',
};
export function subset(a,b) { return (a & b) === a; }
export function bits(mask) { const out=[]; for(let b=1;b<=mask;b*=2) if(mask&b)out.push(b);return out; }
export function subsets(mask) { const out=[];for(let x=0;x<=mask;x++)if(subset(x,mask))out.push(x);return out; }
export function closure(seed, fds, trace=null) {
  let value=seed, changed=true;
  while(changed){ changed=false; for(const fd of fds)if(subset(fd.left,value)&&!subset(fd.right,value)){
    const before=value;value|=fd.right;changed=true;trace?.push({before,after:value,...fd});
  }}return value;
}
export function parse(input) {
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected a schema object.');
  for(const key of ['attributes','dependencies','decomposition'])if(typeof input[key]!=='string'||input[key].length>12000)throw Error(`${key} must be text, at most 12,000 characters.`);
  const attributes=input.attributes.split(',').map(x=>x.trim());
  if(attributes.length<1||attributes.length>8||attributes.some(x=>! /^[A-Za-z][A-Za-z0-9_]{0,23}$/.test(x))||new Set(attributes).size!==attributes.length)throw Error('Use 1–8 distinct attribute names: letters, digits, underscores; start with a letter (24 characters maximum).');
  const mask=text=>{
    if(!text.trim()||text.trim()==='{}')return 0;
    const names=text.split(',').map(x=>x.trim());
    if(names.some(x=>!attributes.includes(x)))throw Error(`Unknown attribute in “${text}”. Use comma-separated names.`);
    if(new Set(names).size!==names.length)throw Error('An attribute is repeated in one set.');
    return names.reduce((m,x)=>m|1<<attributes.indexOf(x),0);
  };
  const lines=input.dependencies.split(/\r?\n/).filter(x=>x.trim());
  if(lines.length>40)throw Error('Use at most 40 dependency lines.');
  const fds=lines.flatMap((line,i)=>{
    const parts=line.split('->');if(parts.length!==2)throw Error(`Dependency ${i+1}: use -> between sets.`);
    const left=mask(parts[0]),right=mask(parts[1]);if(!right)throw Error('A dependency needs a nonempty right side.');
    return bits(right).map(right=>({left,right}));
  });
  const relations=input.decomposition.split(/\r?\n/).filter(x=>x.trim()).map(mask);
  if(relations.length>12||relations.some(x=>!x)||new Set(relations).size!==relations.length)throw Error('Use at most 12 distinct, nonempty relations.');
  const all=(1<<attributes.length)-1;
  if(relations.length&&relations.reduce((a,b)=>a|b,0)!==all)throw Error('The decomposition must include every attribute.');
  return {attributes,fds,relations,all};
}
export function keys(relation, fds) {
  const result=[];
  // Numeric order places every proper subset before its supersets.
  for(const mask of subsets(relation))if(!result.some(k=>subset(k,mask))&&subset(relation,closure(mask,fds)))result.push(mask);
  return result;
}
export function minimalCover(input) {
  let fds=input.filter(f=>!(f.left&f.right)).map(f=>({...f}));
  for(const fd of fds)for(const bit of bits(fd.left)){
    const reduced=fd.left&~bit;if(subset(fd.right,closure(reduced,fds)))fd.left=reduced;
  }
  for(let i=0;i<fds.length;){
    if(subset(fds[i].right,closure(fds[i].left,fds.filter((_,j)=>i!==j))))fds.splice(i,1);else i++;
  }return fds;
}
export function inspectRelation(relation,fds) {
  const candidateKeys=keys(relation,fds),prime=candidateKeys.reduce((a,b)=>a|b,0),violations=[];
  const projected=[];
  for(const left of subsets(relation)){
    const implied=closure(left,fds)&relation;
    for(const right of bits(implied&~left)){
      projected.push({left,right});
      if(implied!==relation)violations.push({left,right,third:!subset(right,prime)});
    }
  }
  return {relation,keys:candidateKeys,prime,normalForm:violations.length===0?'BCNF':violations.some(v=>v.third)?'Below 3NF':'3NF',violations,projected};
}
export function synthesize(all,fds) {
  const cover=minimalCover(fds),groups=new Map();
  for(const f of cover)groups.set(f.left,(groups.get(f.left)||f.left)|f.right);
  let relations=[...new Set(groups.values())];
  relations=relations.filter(r=>!relations.some(other=>other!==r&&subset(r,other)));
  const candidateKeys=keys(all,fds);
  if(!relations.some(r=>candidateKeys.some(k=>subset(k,r))))relations.push(candidateKeys[0]);
  // If the empty set is a key, a cover already supplies nonempty relations.
  if(!relations.length)relations=[all];
  return relations;
}
export function bcnf(all,fds) {
  const pending=[all],relations=[],steps=[];
  while(pending.length){
    const relation=pending.pop(),violation=inspectRelation(relation,fds).violations[0];
    if(!violation){relations.push(relation);continue;}
    const first=closure(violation.left,fds)&relation;
    const second=(relation&~first)|violation.left;
    steps.push({relation,left:violation.left,first,second});pending.push(second,first);
  }return {relations:[...new Set(relations)],steps};
}
export function chase(all,fds,relations) {
  const columns=bits(all),n=columns.length,parent=Array.from({length:n*(relations.length+1)},(_,i)=>i);
  const root=x=>{while(parent[x]!==x){parent[x]=parent[parent[x]];x=parent[x];}return x;};
  const rows=relations.map((r,i)=>columns.map((b,j)=>r&b?j:n+i*n+j));
  const snapshot=()=>rows.map(row=>row.map(root));
  const initial=snapshot(),steps=[];
  let changed=true;
  while(changed){changed=false;
    for(let a=0;a<rows.length;a++)for(let b=a+1;b<rows.length;b++)for(const fd of fds){
      if(!columns.every((bit,j)=>!(fd.left&bit)||root(rows[a][j])===root(rows[b][j])))continue;
      for(let j=0;j<n;j++)if(fd.right&columns[j]){
        const x=root(rows[a][j]),y=root(rows[b][j]);if(x===y)continue;
        parent[Math.max(x,y)]=Math.min(x,y);changed=true;
        steps.push({rows:[a,b],...fd,column:j,merged:[x,y],table:snapshot()});
      }
    }
  }
  const table=snapshot(),witness=table.findIndex(row=>row.every((value,j)=>value===j));
  return {lossless:witness>=0,witness,initial,table,steps};
}
export function inspectDecomposition(all,fds,relations) {
  const components=relations.map(r=>inspectRelation(r,fds));
  const projected=components.flatMap(x=>x.projected);
  const checks=fds.map(fd=>({...fd,derived:closure(fd.left,projected),preserved:subset(fd.right,closure(fd.left,projected))}));
  return {relations,components,preserved:checks.every(x=>x.preserved),checks,chase:chase(all,fds,relations)};
}
export function analyze(input) {
  const schema=parse(input),{all,fds,relations}=schema;
  const third=synthesize(all,fds),bc=bcnf(all,fds);
  return {input:{...input},...schema,cover:minimalCover(fds),original:inspectRelation(all,fds),third:inspectDecomposition(all,fds,third),bcnf:{...inspectDecomposition(all,fds,bc.relations),splits:bc.steps},custom:relations.length?inspectDecomposition(all,fds,relations):null};
}
