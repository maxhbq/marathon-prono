import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minutes, clock, validatePrediction, scorePrediction, ranked } from '../domain.js';

test('les temps respectent HH:mm, sans secondes ni dépassement',()=>{
  assert.equal(minutes('03:45'),225); assert.equal(clock(225),'03:45');
  for(const value of ['3:45','03:60','00:00','24:01','03:45:00','-1:00',null]) assert.equal(minutes(value),null);
  assert.equal(minutes('24:00'),1440);
});
test('un pronostic doit couvrir exactement la liste sans doublon',()=>{
  const runners=[{id:1},{id:2}];
  assert.equal(validatePrediction([{runnerId:2,time:'04:00'},{runnerId:1,time:'03:30'}],runners),null);
  assert.ok(validatePrediction([{runnerId:1,time:'04:00'},{runnerId:1,time:'03:30'}],runners));
  assert.ok(validatePrediction([{runnerId:1,time:'04:00'}],runners));
  assert.ok(validatePrediction([{runnerId:1,time:'04:00'},{runnerId:3,time:'03:30'}],runners));
});
test('les scores utilisent les écarts absolus par coureur, pas une différence de moyennes',()=>{
  const runners=[{id:1,status:'finished',result_position:1,result_minutes:200},{id:2,status:'finished',result_position:2,result_minutes:240}];
  const score=scorePrediction([{runnerId:2,minutes:220},{runnerId:1,minutes:220}],runners);
  assert.deepEqual(score,{position:2,time:20});
  assert.deepEqual(scorePrediction([{runnerId:1,minutes:200},{runnerId:2,minutes:240}],runners),{position:0,time:0});
});
test('abandons et non-partants ex æquo après les arrivants, exclus des chronos',()=>{
  const runners=[{id:1,status:'finished',result_position:1,result_minutes:200},{id:2,status:'finished',result_position:2,result_minutes:240},{id:3,status:'dnf'},{id:4,status:'dns'}];
  const items=[{runnerId:3,minutes:900},{runnerId:1,minutes:210},{runnerId:4,minutes:900},{runnerId:2,minutes:230}];
  assert.deepEqual(scorePrediction(items,runners),{position:5,time:10});
  assert.equal(scorePrediction(items,[...runners,{id:5,status:'pending'}]),null);
  assert.equal(scorePrediction(items,[{id:1,status:'dnf'}]),null);
});
test('les ex æquo partagent leur rang sans départage caché',()=>{
  const entries=[{username:'Zoé',time:4},{username:'Alice',time:4},{username:'Bob',time:8}];
  assert.deepEqual(ranked(entries,'time').map(e=>e.rank),[1,1,3]);
  assert.equal(entries[0].username,'Zoé');
});
