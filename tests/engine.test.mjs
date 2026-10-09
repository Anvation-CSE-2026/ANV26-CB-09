import test from 'node:test';
import assert from 'node:assert/strict';
import {assess,fitBaseline,evaluate,registrationBurst,robustDistance,median,GROUPS} from '../legacy/engine.mjs';
import {world,references,holdout,generateWorld,SHOWCASES} from '../legacy/data.mjs';
const baseline=fitBaseline(references);
const get=id=>world.population.find(p=>p.id===id);

test('required demo cases have distinct bands and corroborating evidence',()=>{
  const cases=SHOWCASES.map(id=>assess(get(id),world.population,baseline));
  assert.deepEqual(cases.map(c=>c.band),['Low','Review','High']);
  assert.ok(cases[1].indicators.length>=3);
  assert.ok(new Set(cases[2].indicators.map(i=>i.group)).size>=3);
  assert.ok(cases[0].mitigations.length>=3);
});
test('every observed and holdout score obeys group caps and sums exactly',()=>{
  for(const cohort of [world.population,holdout.population])for(const p of cohort){
    const r=assess(p,cohort,baseline);
    assert.ok(Number.isFinite(r.score)&&r.score>=0&&r.score<=100);
    assert.equal(r.score,r.groups.reduce((s,g)=>s+g.score,0));
    for(const g of r.groups){assert.ok(g.score<=g.cap);assert.equal(g.score,Math.min(g.raw,g.cap));}
  }
  assert.equal(GROUPS.reduce((s,g)=>s+g.cap,0),100);
});
test('ground truth and display names cannot change an assessment',()=>{
  const p=get('CASE-003'),r=assess(p,world.population,baseline);
  const changed={...p,displayName:'Definitely legitimate',truth:'legitimate',scenario:'legitimate',fraudLabel:false};
  assert.equal(assess(changed,world.population,baseline).score,r.score);
});
test('profile conflicts are computed from supplied records rather than an asserted count',()=>{
  const p=structuredClone(get('CASE-001'));
  p.profileConflicts=100;
  assert.ok(!assess(p,[p],baseline).indicators.some(i=>i.id==='profile-conflicts'));
  p.profileRecords[1].birthYear+=1;
  assert.equal(assess(p,[p],baseline).indicators.find(i=>i.id==='profile-conflicts').points,9);
});
test('a shared household device alone cannot trigger high risk',()=>{
  const p=structuredClone(get('CASE-001')),peer=structuredClone(p);
  peer.id='HOUSEHOLD-PEER';peer.phoneToken='OTHER-PHONE';peer.addressToken='OTHER-ADDRESS';
  peer.createdAt=new Date(Date.parse(p.createdAt)+86400000).toISOString();
  const result=assess(p,[p,peer],baseline);
  assert.equal(result.score,3);assert.equal(result.band,'Low');
});
test('omission is monotonic, respects caps and does not mutate the original',()=>{
  const p=get('CASE-003'),before=JSON.stringify(p),r=assess(p,world.population,baseline);
  for(const i of r.indicators){const omitted=assess(p,world.population,baseline,[i.id]);assert.ok(omitted.score<=r.score);assert.ok(!omitted.indicators.some(x=>x.id===i.id));}
  assert.equal(assess(p,world.population,baseline,r.indicators.map(i=>i.id)).score,0);
  assert.equal(JSON.stringify(p),before);
  // Removing a 5-point indicator from a capped category must not naively deduct five.
  assert.equal(assess(p,world.population,baseline,['unverified-phone']).groups[0].score,25);
});
test('registration burst uses a 30-minute sliding window, not total shared accounts',()=>{
  const p=structuredClone(get('CASE-001'));
  p.events.forEach(e=>e.deviceId='TEST-SHARED');
  const peers=[0,10,20,60].map((minutes,i)=>({...structuredClone(p),id:`WINDOW-${i}`,createdAt:new Date(Date.parse(p.createdAt)+minutes*60000).toISOString()}));
  assert.equal(registrationBurst(peers[0],peers).count,3);
  const atBoundary=[0,30,31].map((minutes,i)=>({...structuredClone(p),id:`BOUNDARY-${i}`,createdAt:new Date(Date.parse(p.createdAt)+minutes*60000).toISOString()}));
  assert.equal(registrationBurst(atBoundary[0],atBoundary).count,2);
});
test('dataset is reproducible, temporally valid, and disjoint from reference and holdout',()=>{
  assert.deepEqual(generateWorld().population,world.population);
  const allIds=[...world.population,...references,...holdout.population].map(p=>p.id);
  assert.equal(new Set(allIds).size,allIds.length);
  for(const p of [...world.population,...references,...holdout.population]){
    assert.ok(Date.parse(p.emailCreatedAt)<=Date.parse(p.createdAt));
    for(const e of p.events)assert.ok(Date.parse(e.timestamp)>=Date.parse(p.createdAt));
  }
});
test('evaluation accounts for every case and exposes intentional false negatives',()=>{
  const m=evaluate(holdout.population,holdout.truth,baseline);
  assert.equal(m.tp+m.fp+m.tn+m.fn,holdout.population.length);
  assert.ok(m.fn>0);assert.ok(m.reviewCount>0);assert.ok(m.recall>0&&m.recall<1);
  assert.ok(m.precision>=0&&m.precision<=1);
});
test('median and robust distance handle zero dispersion; missing observations fail explicitly',()=>{
  assert.equal(median([5,1,4,2]),3);
  assert.equal(robustDistance(40,{median:10,mad:0},15),2);
  assert.throws(()=>assess({events:[]},[],baseline),/observation/);
});
