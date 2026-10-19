import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';

let server,base,adminCookie='',aliceCookie='',bobCookie='',dataDir;
const root=resolve(import.meta.dirname,'..');
async function request(path,{method='GET',body,cookie='',race=1,origin}={}){
  const r=await fetch(`${base}${path}?race=${race}`,{method,headers:{'Content-Type':'application/json',Origin:origin||base,...(cookie?{Cookie:cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await r.json();return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0],headers:r.headers};
}
before(async()=>{
  dataDir=await mkdtemp(resolve(tmpdir(),'bornes-test-'));
  const admin=spawnSync(process.execPath,['admin.js','Organisateur'],{cwd:root,env:{...process.env,DATA_DIR:dataDir,ADMIN_PASSWORD:'mot-de-passe-test-uniquement'},encoding:'utf8'});
  assert.equal(admin.status,0,admin.stderr);
  const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
  base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:String(port),NODE_ENV:'test',APP_ORIGIN:base},stdio:['ignore','pipe','pipe']});
  let errors='';server.stderr.on('data',d=>errors+=d);
  await Promise.race([once(server.stdout,'data'),once(server,'exit').then(()=>{throw new Error(errors||'Échec du démarrage');}),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('Démarrage trop long')),10000);t.unref();})]);
});
after(async()=>{if(server&&!server.killed){server.kill('SIGTERM');await once(server,'exit');}if(dataDir)await rm(dataDir,{recursive:true,force:true});});

test('parcours complet multi-courses, confidentialité, clôture, résultats et sécurité',async t=>{
  let ids;
  await t.test('la page et les ressources sont servies avec une CSP',async()=>{
    const r=await fetch(base);assert.equal(r.status,200);assert.match(await r.text(),/Les 18 Bornes/);assert.match(r.headers.get('content-security-policy'),/script-src 'self'/);
    for(const path of ['/app.js','/styles.css','/favicon.svg'])assert.equal((await fetch(base+path)).status,200);
    assert.equal((await fetch(base+'/.data/marathon.sqlite')).status,404);
  });
  await t.test('authentification et séparation des rôles',async()=>{
    let r=await request('/api/login',{method:'POST',body:{username:'Organisateur',password:'mot-de-passe-test-uniquement'}});assert.equal(r.status,200);adminCookie=r.cookie;assert.match(r.headers.get('set-cookie'),/HttpOnly/);
    r=await request('/api/register',{method:'POST',body:{username:'Alice',password:'une-longue-phrase-alice'}});assert.equal(r.status,201);aliceCookie=r.cookie;
    r=await request('/api/register',{method:'POST',body:{username:'Bob',password:'une-longue-phrase-bob'}});assert.equal(r.status,201);bobCookie=r.cookie;
    assert.equal((await request('/api/register',{method:'POST',body:{username:'alice',password:'autre-longue-phrase'}})).status,409);
    assert.equal((await request('/api/admin/runners',{method:'POST',body:{name:'Interdit'},cookie:aliceCookie})).status,403);
    assert.equal((await request('/api/admin/runners',{method:'POST',body:{name:'Interdit'}})).status,401);
    assert.equal((await request('/api/login',{method:'POST',body:{username:'Alice',password:'mauvais-mot-de-passe'}})).status,401);
    assert.equal((await request('/api/login',{method:'POST',origin:'https://ailleurs.test',body:{username:'Alice',password:'une-longue-phrase-alice'}})).status,403);
  });
  await t.test('gestion des coureurs, photos et clôture manuelle sans date',async()=>{
    for(const name of ['Camille','Nico','Sam'])assert.equal((await request('/api/admin/runners',{method:'POST',body:{name},cookie:adminCookie})).status,201);
    let s=(await request('/api/state')).data;ids=s.runners.map(r=>r.id);
    assert.equal(s.settings.starts_at,'2026-10-25T08:00:00.000Z');
    assert.equal((await request('/api/admin/settings',{method:'PUT',cookie:adminCookie,body:{raceName:'Marathon de Lille',startsAt:null,closed:false}})).status,200);
    const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=';
    assert.equal((await request(`/api/admin/runners/${ids[0]}/photo`,{method:'POST',cookie:adminCookie,body:{data:png}})).status,200);
    s=(await request('/api/state')).data;assert.equal((await fetch(base+s.runners[0].photo)).status,200);
    assert.equal((await request(`/api/admin/runners/${ids[0]}/photo`,{method:'POST',cookie:adminCookie,body:{data:'data:image/png;base64,SGVsbG8='}})).status,400);
  });
  await t.test('pronostics complets et secrets avant le départ',async()=>{
    const s=(await request('/api/state')).data;
    const items=ids.map((id,i)=>({runnerId:id,time:['03:30','04:00','04:30'][i]}));
    assert.equal((await request('/api/prediction',{method:'PUT',cookie:aliceCookie,body:{items,rosterVersion:s.settings.roster_version}})).status,200);
    assert.equal((await request('/api/prediction',{method:'PUT',cookie:bobCookie,body:{items:[items[1],items[0],items[2]],rosterVersion:s.settings.roster_version}})).status,200);
    assert.equal((await request('/api/prediction',{method:'PUT',cookie:aliceCookie,body:{items:[items[0],items[0],items[2]],rosterVersion:s.settings.roster_version}})).status,400);
    const publicState=(await request('/api/state')).data;
    assert.equal(publicState.predictionCount,2);assert.deepEqual(publicState.predictions,[]);assert.equal(publicState.myPrediction,null);
    const mine=(await request('/api/state',{cookie:aliceCookie})).data;assert.equal(mine.myPrediction.items.length,3);assert.deepEqual(mine.predictions,[]);
  });
  await t.test('les courses et les opérations sur les coureurs sont isolées',async()=>{
    const result=await request('/api/admin/races',{method:'POST',cookie:adminCookie,body:{name:'Paris 2027'}});assert.equal(result.status,201);const race=result.data.raceId;
    const s=(await request('/api/state',{race,cookie:aliceCookie})).data;assert.equal(s.runners.length,0);assert.equal(s.predictionCount,0);assert.equal(s.myPrediction,null);
    assert.equal((await request(`/api/admin/runners/${ids[0]}`,{method:'DELETE',cookie:adminCookie,race})).status,404);
    assert.equal((await request('/api/admin/runners',{method:'POST',cookie:adminCookie,race,body:{name:'Autre coureur'}})).status,201);
    assert.equal((await request('/api/state')).data.runners.length,3);
    assert.equal((await request('/api/state')).data.predictionCount,2);
  });
  await t.test('une liste modifiée invalide les anciens pronostics',async()=>{
    await request('/api/admin/runners',{method:'POST',cookie:adminCookie,body:{name:'Temporaire'}});
    let s=(await request('/api/state',{cookie:aliceCookie})).data;assert.equal(s.myPrediction.valid,false);assert.equal(s.predictionCount,0);
    const temp=s.runners.at(-1).id;await request(`/api/admin/runners/${temp}`,{method:'DELETE',cookie:adminCookie});
    s=(await request('/api/state')).data;
    const items=ids.map((id,i)=>({runnerId:id,time:['03:30','04:00','04:30'][i]}));
    assert.equal((await request('/api/prediction',{method:'PUT',cookie:aliceCookie,body:{items,rosterVersion:s.settings.roster_version-1}})).status,409);
    for(const [cookie,pred] of [[aliceCookie,items],[bobCookie,[items[1],items[0],items[2]]]])assert.equal((await request('/api/prediction',{method:'PUT',cookie,body:{items:pred,rosterVersion:s.settings.roster_version}})).status,200);
  });
  await t.test('clôture automatique côté serveur, même sans navigateur',async()=>{
    assert.equal((await request('/api/admin/settings',{method:'PUT',cookie:adminCookie,body:{raceName:'Lille',startsAt:'2020-01-01T09:00:00Z',closed:false}})).status,200);
    const s=(await request('/api/state')).data;assert.equal(s.settings.closed,true);assert.equal(s.predictions.length,2);
    assert.equal((await request('/api/prediction',{method:'PUT',cookie:aliceCookie,body:{items:[],rosterVersion:s.settings.roster_version}})).status,409);
    assert.equal((await request('/api/admin/runners',{method:'POST',cookie:adminCookie,body:{name:'Trop tard'}})).status,409);
  });
  await t.test('résultats privés, validation des positions et publication explicite',async()=>{
    const items=[{runnerId:ids[0],status:'finished',position:1,time:'03:40'},{runnerId:ids[1],status:'finished',position:2,time:'03:50'},{runnerId:ids[2],status:'dnf'}];
    assert.equal((await request('/api/admin/publish',{method:'POST',cookie:adminCookie,body:{published:true}})).status,409);
    assert.equal((await request('/api/admin/results',{method:'PUT',cookie:adminCookie,body:{items:[items[0],{...items[1],position:1},items[2]]}})).status,400);
    assert.equal((await request('/api/admin/results',{method:'PUT',cookie:adminCookie,body:{items}})).status,200);
    let s=(await request('/api/state')).data;assert.equal(s.runners[0].time,null);assert.equal(s.runners[0].status,'pending');assert.deepEqual(s.leaderboards.position,[]);
    assert.equal((await request('/api/state',{cookie:adminCookie})).data.runners[0].time,'03:40');
    assert.equal((await request('/api/admin/publish',{method:'POST',cookie:adminCookie,body:{published:true}})).status,200);
    s=(await request('/api/state')).data;assert.equal(s.runners[0].time,'03:40');assert.equal(s.leaderboards.position[0].username,'Alice');assert.equal(s.leaderboards.position[0].position,0);assert.equal(s.leaderboards.position[1].position,2);assert.equal(s.leaderboards.time[0].time,10);assert.deepEqual(s.leaderboards.time.map(e=>e.rank),[1,1]);
    assert.equal((await request('/api/admin/results',{method:'PUT',cookie:adminCookie,body:{items}})).status,409);
    const exported=await request('/api/admin/export',{cookie:adminCookie});assert.equal(exported.status,200);assert.equal(exported.data.predictions.length,2);assert.ok(!JSON.stringify(exported.data).includes('password_hash'));
    assert.equal((await request('/api/admin/export',{cookie:aliceCookie})).status,403);
  });
  await t.test('réinitialisation du mot de passe et révocation des sessions',async()=>{
    const users=(await request('/api/admin/users',{cookie:adminCookie})).data;const alice=users.find(u=>u.username==='Alice');
    assert.equal((await request('/api/admin/password',{method:'POST',cookie:adminCookie,body:{userId:alice.id,password:'un-nouveau-mot-de-passe'}})).status,200);
    assert.equal((await request('/api/state',{cookie:aliceCookie})).data.user,null);
    const login=await request('/api/login',{method:'POST',body:{username:'Alice',password:'un-nouveau-mot-de-passe'}});assert.equal(login.status,200);
    assert.equal((await request('/api/logout',{method:'POST',cookie:login.cookie,body:{}})).status,200);
    assert.equal((await request('/api/state',{cookie:login.cookie})).data.user,null);
  });
  await t.test('la sauvegarde en ligne contient une base cohérente et préserve les données',async()=>{
    const destination=`${dataDir}-backup`;
    try {
      const saved=spawnSync(process.execPath,['backup.js',destination],{cwd:root,env:{...process.env,DATA_DIR:dataDir},encoding:'utf8'});
      assert.equal(saved.status,0,saved.stderr);
      const copy=new DatabaseSync(resolve(destination,'marathon.sqlite'),{readOnly:true});
      assert.equal(copy.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      assert.equal(copy.prepare('SELECT count(*) AS n FROM users').get().n,3);
      assert.equal(copy.prepare('SELECT count(*) AS n FROM settings').get().n,2);
      assert.equal(copy.prepare('SELECT count(*) AS n FROM predictions').get().n,2);
      copy.close();
      const again=spawnSync(process.execPath,['backup.js',destination],{cwd:root,env:{...process.env,DATA_DIR:dataDir},encoding:'utf8'});
      assert.notEqual(again.status,0,'Une sauvegarde existante ne doit pas être écrasée');
    } finally { await rm(destination,{recursive:true,force:true}); }
  });
  await t.test('courses, pronostics, résultats et sessions survivent au redémarrage',async()=>{
    server.kill('SIGTERM');await once(server,'exit');
    server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,DATA_DIR:dataDir,HOST:'127.0.0.1',PORT:new URL(base).port,NODE_ENV:'test',APP_ORIGIN:base},stdio:['ignore','pipe','pipe']});
    await once(server.stdout,'data');
    const s=(await request('/api/state',{cookie:adminCookie})).data;
    assert.equal(s.races.length,2);assert.equal(s.predictionCount,2);assert.equal(s.settings.published,true);assert.equal(s.user.role,'admin');assert.equal(s.leaderboards.position[0].username,'Alice');
  });
});
