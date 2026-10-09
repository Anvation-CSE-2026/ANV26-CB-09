// Scoring receives observations only. Ground truth is kept outside this module.
export const MODEL_VERSION = '1.0.0';
export const GROUPS = [
  { key: 'identity', label: 'Identity consistency', cap: 25 },
  { key: 'device', label: 'Device signals', cap: 25 },
  { key: 'behaviour', label: 'Behaviour & anomalies', cap: 30 },
  { key: 'graph', label: 'Shared relationships', cap: 20 },
];
export const median = values => {
  if (!values.length) return 0;
  const a = [...values].sort((a,b)=>a-b), m = Math.floor(a.length/2);
  return a.length%2 ? a[m] : (a[m-1]+a[m])/2;
};
const mean = a => a.reduce((s,v)=>s+v,0)/(a.length||1);
const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
export function summarise(identity) {
  const events = identity.events;
  return {
    formSeconds: mean(events.map(e=>e.formSeconds)),
    editCount: mean(events.map(e=>e.editCount)),
    failedAttempts: events.reduce((s,e)=>s+e.failedAttempts,0),
    mismatchRate: events.filter(e=>e.region!==identity.declaredRegion).length/(events.length||1),
    sessionCount: events.length,
    latest: events.at(-1)?.timestamp,
    devices: [...new Set(events.map(e=>e.deviceId))],
  };
}
export function fitBaseline(references) {
  // Independent synthetic reference cohort; never fitted on the cases being evaluated.
  const summaries = references.map(summarise);
  const fit = key => {
    const values=summaries.map(s=>s[key]), centre=median(values);
    return { median:centre, mad:median(values.map(v=>Math.abs(v-centre))), n:values.length };
  };
  return { formSeconds:fit('formSeconds'), editCount:fit('editCount'), n:references.length };
}
export function robustDistance(value, baseline, minimumScale=1) {
  return Math.abs(value-baseline.median)/Math.max(minimumScale,1.4826*baseline.mad);
}
export function sharedEntities(identity, population) {
  const summary=summarise(identity);
  const definitions=[
    ['device','Device',summary.devices],
    ['address','Address',[identity.addressToken]],
    ['phone','Recovery phone',[identity.phoneToken]],
  ];
  return definitions.flatMap(([type,label,values])=>values.map(value=>({
    type,label,value,
    peers:population.filter(p=>p.id!==identity.id && (type==='device' ? summarise(p).devices.includes(value) : p[type==='address'?'addressToken':'phoneToken']===value)).map(p=>p.id),
  }))).filter(e=>e.peers.length);
}
export function registrationBurst(identity,population) {
  const devices=summarise(identity).devices, windowMs=30*60*1000;
  const related=population.filter(p=>summarise(p).devices.some(d=>devices.includes(d)));
  const times=related.map(p=>Date.parse(p.createdAt)).sort((a,b)=>a-b);
  let max=0;
  for (let l=0,r=0;r<times.length;r++) {
    while(times[r]-times[l]>windowMs) l++;
    max=Math.max(max,r-l+1);
  }
  return { count:max, windowMinutes:30, total:related.length };
}
export function assess(identity,population,baseline,excluded=[]) {
  if (!identity?.events?.length) throw new Error('A case requires at least one observation.');
  const summary=summarise(identity), links=sharedEntities(identity,population);
  const conflicts=identity.profileRecords ? ['birthYear','declaredRegion'].filter(key=>new Set(identity.profileRecords.map(record=>record[key])).size>1) : Array.from({length:identity.profileConflicts},(_,i)=>`attribute ${i+1}`);
  const profileConflicts=conflicts.length;
  const burst=registrationBurst(identity,population), indicators=[];
  const add=(id,group,title,points,observed,reason,context)=>indicators.push({id,group,title,points,observed,reason,context});
  const emailDays=(Date.parse(identity.createdAt)-Date.parse(identity.emailCreatedAt))/86400000;
  if(emailDays<30) add('new-email','identity','Recently created email',emailDays<7?7:4,`${Math.max(0,Math.floor(emailDays))} days old at registration`,'Limited email history adds a weak identity signal.','New users also create new email accounts. This signal is never sufficient on its own.');
  if(profileConflicts>0) add('profile-conflicts','identity','Conflicting profile attributes',Math.min(18,profileConflicts*9),`${profileConflicts} consistency checks failed: ${conflicts.map(k=>k==='birthYear'?'birth year':k==='declaredRegion'?'declared region':k).join(', ')}`,'Synthetic profile fields disagree across the supplied registration and verification records.','A failed consistency check can also result from a data-entry error.');
  if(!identity.phoneVerified) add('unverified-phone','identity','Phone verification incomplete',5,'No completed verification in the dataset','The supplied contact channel has not been verified.','Missing verification is an evidence gap, not proof of fraud.');
  const mostPeers=Math.max(0,...links.filter(e=>e.type==='device').map(e=>e.peers.length));
  if(mostPeers>0) add('shared-device','device','Device used by multiple identities',mostPeers>=4?10:mostPeers>=2?6:3,`${mostPeers+1} identities share a device`,'The same synthetic fingerprint is present on several accounts.','Households and shared workstations can explain device reuse; related activity must corroborate it.');
  if(identity.emulatedDevice) add('emulator','device','Emulated device environment',8,'Emulation flag present','The supplied device telemetry indicates an emulated environment.','Emulators also have legitimate accessibility and testing uses.');
  if(identity.deviceIntegrityMismatch) add('device-integrity','device','Device attributes conflict',9,'Browser and platform attributes disagree','The synthetic fingerprint reports incompatible platform attributes.','One inconsistent attribute may be caused by browser privacy settings.');
  if(summary.mismatchRate>=0.35) add('region-mismatch','behaviour','Repeated region inconsistency',summary.mismatchRate>=0.7?7:4,`${Math.round(summary.mismatchRate*100)}% of sessions outside declared region`,'Observed regions repeatedly differ from the declared region.','Travel and network routing can explain location changes.');
  if(summary.failedAttempts>=4) add('failed-attempts','behaviour','Repeated unsuccessful sign-ins',summary.failedAttempts>=12?7:4,`${summary.failedAttempts} failures across ${summary.sessionCount} sessions`,'Repeated failed attempts accompany the observed activity.','Credential mistakes can produce the same pattern.');
  if(burst.count>=3) add('registration-burst','behaviour','Concentrated registration activity',burst.count>=5?10:6,`${burst.count} identities registered within 30 minutes on shared devices`,'A short registration burst corroborates shared-device activity.','This measures registrations, not account age; shared-device evidence is scored separately.');
  const durationZ=robustDistance(summary.formSeconds,baseline.formSeconds,15);
  const editsZ=robustDistance(summary.editCount,baseline.editCount,1);
  const anomaly=Math.max(durationZ,editsZ);
  if(anomaly>=2.5) add('behaviour-anomaly','behaviour','Unusual form-completion behaviour',anomaly>=4?10:6,`${Math.round(summary.formSeconds)}s mean completion · ${summary.editCount.toFixed(1)} field edits`,'Completion or editing activity differs from the independent reference cohort.','Fast completion alone may reflect familiarity or assistive tools.');
  const phoneLink=links.find(e=>e.type==='phone');
  if(phoneLink) add('shared-phone','graph','Recovery contact reused',phoneLink.peers.length>=3?12:phoneLink.peers.length>=2?8:4,`${phoneLink.peers.length+1} identities use ${phoneLink.value}`,'Several identities share the same recovery contact.','A family contact may be shared legitimately. Inspect other links and timing.');
  const addressLink=links.find(e=>e.type==='address');
  if(addressLink?.peers.length>=3) add('shared-address','graph','Address linked to many identities',addressLink.peers.length>=5?8:5,`${addressLink.peers.length+1} identities claim ${addressLink.value}`,'The address links multiple identities in the synthetic network.','Shared housing or offices can explain address reuse.');
  const mitigations=[];
  if(!profileConflicts) mitigations.push({title:'Profile attributes are consistent',evidence:'All supplied profile consistency checks passed.'});
  if(identity.phoneVerified) mitigations.push({title:'Contact verification completed',evidence:'The supplied synthetic phone-verification status is completed.'});
  if(summary.mismatchRate<0.2) mitigations.push({title:'Location pattern is stable',evidence:`${Math.round((1-summary.mismatchRate)*100)}% of sessions match the declared region.`});
  if(!identity.emulatedDevice&&!identity.deviceIntegrityMismatch) mitigations.push({title:'Device attributes are coherent',evidence:'No emulation or conflicting platform attributes observed.'});
  if(burst.count<3) mitigations.push({title:'No concentrated registration burst',evidence:'Shared-device registrations do not meet the 3-in-30-minute threshold.'});
  const active=indicators.filter(i=>!excluded.includes(i.id));
  const groups=GROUPS.map(g=>({...g,raw:active.filter(i=>i.group===g.key).reduce((s,i)=>s+i.points,0)})).map(g=>({...g,score:Math.min(g.cap,g.raw)}));
  const score=clamp(groups.reduce((s,g)=>s+g.score,0),0,100);
  const band=score>=60?'High':score>=25?'Review':'Low';
  const top=[...active].sort((a,b)=>b.points-a.points).slice(0,3);
  const explanation=score===0 ? 'The supplied observations show consistent profile details, coherent device attributes and behaviour within the reference range. No configured risk indicators were triggered. This indicates low observed risk, not verified authenticity.' : `${band==='High'?'Several corroborating signals support prioritised review':band==='Review'?'Mixed evidence warrants additional review':'The observed warning signals are limited'}: ${top.map(i=>i.title.toLowerCase()).join(', ')}. ${mitigations.length?mitigations[0].title+'. ':''}The assessment flags potential identity fraud; it does not establish that the identity is synthetic.`;
  return {id:identity.id,score,band,groups,indicators:active,mitigations,links,summary,burst,anomaly:{distance:anomaly,durationDistance:durationZ,editDistance:editsZ,referenceN:baseline.n},explanation,version:MODEL_VERSION,excluded:[...excluded]};
}
export function evaluate(population,truth,baseline) {
  let tp=0,fp=0,tn=0,fn=0;
  const results=population.map(p=>assess(p,population,baseline));
  for(const r of results) {
    const predicted=r.score>=60, actual=truth[r.id]==='suspicious';
    if(predicted&&actual)tp++; else if(predicted)fp++; else if(actual)fn++; else tn++;
  }
  return {tp,fp,tn,fn,precision:tp/(tp+fp||1),recall:tp/(tp+fn||1),falsePositiveRate:fp/(fp+tn||1),n:results.length,reviewCount:results.filter(r=>r.band==='Review').length};
}
