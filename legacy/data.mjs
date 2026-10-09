// All values are invented. Tokens stand in for personal data; no external records.
export const DATASET_SEED = 2404;
export const AS_OF = '2026-10-08T12:00:00Z';
const DAY=86400000;
function rng(seed) {return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const iso=t=>new Date(t).toISOString();
const REGIONS=['North','South','East','West'];
function createCase(index,kind,random,prefix,offset=0) {
  const id=`${prefix}-${String(index+1).padStart(3,'0')}`, suspicious=kind==='suspicious', ambiguous=kind==='ambiguous';
  const cluster=Math.floor(index/6), created=Date.parse(AS_OF)-(suspicious?4:12+Math.floor(random()*140))*DAY;
  const time=suspicious?created+index%6*4*60000:created;
  const region=REGIONS[Math.floor(random()*4)];
  const family=ambiguous&&index%2===0;
  const device=suspicious?`DEV-${prefix}-R${cluster}`:family?`DEV-${prefix}-F${Math.floor(index/2)}`:`DEV-${id}`;
  const sessionCount=4+Math.floor(random()*6);
  const events=Array.from({length:sessionCount},(_,j)=>({
    id:`EVT-${id}-${j+1}`,timestamp:iso(time+(j+0.5)*(Date.parse(AS_OF)-time)/(sessionCount+1)),deviceId:device,
    ipToken:suspicious?`IP-${prefix}-R${cluster}`:`IP-${id}-${j%2}`,
    region:suspicious||ambiguous&&j%2===0?REGIONS[(REGIONS.indexOf(region)+1)%4]:region,
    formSeconds:suspicious?12+random()*18:ambiguous?40+random()*30:95+random()*160,
    editCount:suspicious?0:ambiguous?1+Math.floor(random()*2):2+Math.floor(random()*6),
    failedAttempts:suspicious?2+Math.floor(random()*3):ambiguous?j%2:random()<0.12?1:0,
  }));
  const result={id,displayName:`Subject ${String(index+1+offset).padStart(3,'0')}`,declaredRegion:region,createdAt:iso(time),emailCreatedAt:iso(time-(suspicious?2:ambiguous?14:180+Math.floor(random()*700))*DAY),phoneVerified:!suspicious,profileConflicts:suspicious?2:0,emulatedDevice:suspicious,deviceIntegrityMismatch:suspicious&&index%2===0,addressToken:suspicious?`ADDR-${prefix}-R${cluster}`:`ADDR-${id}`,phoneToken:suspicious?`PHONE-${prefix}-R${cluster}`:`PHONE-${id}`,events};
  // Overlapping evidence: some benign cases are unusual; some fraudulent cases are subtle.
  // The reference cohort is separate, while test worlds include these harder cases.
  if(!['REF','CASE'].includes(prefix)) {
    if(kind==='legitimate'&&index%11===0) {
      result.emailCreatedAt=iso(time-4*DAY);
      for(const [j,e] of events.entries()) {e.formSeconds=35+random()*25;e.region=j%2?region:REGIONS[(REGIONS.indexOf(region)+1)%4];e.failedAttempts=j%2;}
    }
    if(ambiguous) {
      result.phoneVerified=index%3!==0;
      result.profileConflicts=index%4===0?1:0;
      result.emailCreatedAt=iso(time-(index%2?3:14)*DAY);
      if(index%3===0)for(const e of events)e.failedAttempts=1;
    }
    if(suspicious) {
      result.profileConflicts=index%3===0?0:index%3===1?1:2;
      result.phoneVerified=index%3===0;
      result.emulatedDevice=index%3!==0;
      result.deviceIntegrityMismatch=index%4===0;
      for(const e of events){e.formSeconds=25+random()*85;e.editCount=Math.floor(random()*4);e.failedAttempts=index%3===0?0:1+Math.floor(random()*3);}
      if(index%9===0) {
        // Isolated synthetic identity with sparse warning signs: an intentional missed case.
        result.phoneToken=`PHONE-${id}`;result.addressToken=`ADDR-${id}`;
        for(const e of events){e.deviceId=`DEV-${id}`;e.region=region;}
      }
    }
  }
  const birthYear=1985+index%20;
  result.profileRecords=[
    {source:'Registration record',birthYear,declaredRegion:region},
    {source:'Verification record',birthYear:birthYear+(result.profileConflicts>=1?2:0),declaredRegion:result.profileConflicts>=2?REGIONS[(REGIONS.indexOf(region)+1)%4]:region},
  ];
  result.deviceAttributes={reportedPlatform:'Synthetic Desktop',browserPlatform:result.deviceIntegrityMismatch?'Synthetic Mobile':'Synthetic Desktop',environment:result.emulatedDevice?'Emulated':'Standard'};
  return result;
}
export function generateWorld(seed=DATASET_SEED,{prefix='ID',count=180,showcase=true}={}) {
  const random=rng(seed), population=[],truth={};
  for(let i=0;i<count;i++) {
    const kind=i<Math.floor(count*0.7)?'legitimate':i<Math.floor(count*0.9)?'ambiguous':'suspicious';
    const p=createCase(i,kind,random,prefix);
    population.push(p);truth[p.id]=kind;
  }
  if(showcase) {
    const legitimate=createCase(0,'legitimate',random,'CASE');
    legitimate.displayName='Established customer';
    const ambiguous=createCase(1,'ambiguous',random,'CASE');
    ambiguous.displayName='Shared-device applicant';
    // Known benign family relationship in the generator; scorer sees only shared observations.
    const sibling=population.find(p=>truth[p.id]==='legitimate');
    for(const e of ambiguous.events)e.deviceId=sibling.events[0].deviceId;
    ambiguous.phoneToken=sibling.phoneToken;
    ambiguous.emailCreatedAt=iso(Date.parse(ambiguous.createdAt)-3*DAY);
    const suspicious=createCase(2,'suspicious',random,'CASE');
    suspicious.displayName='Linked registration cluster';
    const ring=population.filter(p=>truth[p.id]==='suspicious').slice(0,5);
    const base=Date.parse(suspicious.createdAt);
    for(const [j,p] of ring.entries()) {
      p.createdAt=iso(base+(j+1)*3*60000);
      p.emailCreatedAt=iso(Date.parse(p.createdAt)-2*DAY);
      p.addressToken=suspicious.addressToken;p.phoneToken=suspicious.phoneToken;
      for(const e of p.events){e.deviceId=suspicious.events[0].deviceId;e.ipToken=suspicious.events[0].ipToken;}
    }
    population.unshift(legitimate,ambiguous,suspicious);
    truth[legitimate.id]='legitimate';truth[ambiguous.id]='ambiguous';truth[suspicious.id]='suspicious';
  }
  return {population,truth};
}
export function referenceCohort(seed=4917,count=240) {
  const random=rng(seed);
  return Array.from({length:count},(_,i)=>createCase(i,'legitimate',random,'REF'));
}
export const world=generateWorld();
export const references=referenceCohort();
export const holdout=generateWorld(9021,{prefix:'TEST',count:240,showcase:false});
export const SHOWCASES=['CASE-001','CASE-002','CASE-003'];
