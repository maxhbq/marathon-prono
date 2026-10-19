import assert from 'node:assert/strict';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const projectId='demo-les18-bornes',base='http://127.0.0.1:5000';
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099','Ce test doit utiliser uniquement l’émulateur Auth.');
const env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080}});
await env.clearFirestore();
const adminAuth=getAuth(initializeApp({projectId}));
const coach=await adminAuth.createUser({email:'coach@pseudos.invalid',password:'mot-de-passe-fixture-coach'});
await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();
  await setDoc(doc(db,'users',coach.uid),{username:'Coach',created_at:serverTimestamp()});
  await setDoc(doc(db,'admins',coach.uid),{enabled:true,created_at:serverTimestamp()});
});
let browser;
const errors=[];
async function state(page){return page.evaluate(async()=>{const {firebaseRequest}=await import('/firebase-adapter.js');return firebaseRequest('/api/state',{},Number(new URL(location.href).searchParams.get('race')||1));});}
async function login(page,username,password,register=false){
  await page.getByRole('button',{name:/Se connecter/}).first().click();
  if(register)await page.getByRole('button',{name:'Rejoindre la bande',exact:true}).click();
  await page.locator('#auth-form [name=username]').fill(username);
  await page.locator('#auth-form [name=password]').fill(password);
  await page.locator('#auth-form button').last().click();
  await page.locator('#auth-dialog').waitFor({state:'hidden'});
}
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base);await login(page,'Coach','mot-de-passe-fixture-coach');
  await page.getByRole('button',{name:'Administration',exact:true}).click();
  await page.locator('#settings-form [name=startsAt]').fill('');
  await page.locator('#settings-form button').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Réglages enregistrés.');
  for(const name of ['Camille','Nico','Sam']){
    await page.locator('#add-runner-form input').fill(name);await page.locator('#add-runner-form button').click();
    await page.locator(`.admin-runner input[value="${name}"]`).waitFor();
  }
  // Exercise real image decoding/compression and the Firestore photo field without Storage.
  const photo=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=32;c.height=32;const x=c.getContext('2d');x.fillStyle='#def25b';x.fillRect(0,0,32,32);return c.toDataURL('image/png').split(',')[1];});
  await page.locator('[data-photo]').first().setInputFiles({name:'photo.png',mimeType:'image/png',buffer:Buffer.from(photo,'base64')});
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Photo ajoutée !');
  assert.match((await state(page)).runners[0].photo,/^data:image\/jpeg;base64,/);
  const aliceContext=await browser.newContext({viewport:{width:390,height:844}}),alice=await aliceContext.newPage();
  alice.on('pageerror',e=>errors.push(e.message));
  await alice.goto(base);await login(alice,'Alice','mot-de-passe-fixture-alice',true);
  assert.equal((await state(alice)).user.role,'user');
  for(let i=0;i<3;i++)await alice.locator('[data-time]').nth(i).fill(['03:30','04:00','04:30'][i]);
  const first=await alice.locator('.runner-row').first().getAttribute('data-runner');
  await alice.locator('.runner-row').first().getByRole('button',{name:/Descendre/}).click();
  assert.notEqual(await alice.locator('.runner-row').first().getAttribute('data-runner'),first);
  await alice.locator('.runner-row').nth(1).getByRole('button',{name:/Monter/}).click();
  await alice.locator('#prediction-form button[type=submit]').click();
  await alice.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Enregistré'));
  assert.equal((await state(alice)).myPrediction.items[0].time,'03:30');
  assert.deepEqual((await state(page)).predictions,[]);
  await alice.reload();await alice.locator('#prediction-form').waitFor();
  assert.equal(await alice.locator('[data-time]').first().inputValue(),'03:30');
  assert.equal(await alice.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await alice.screenshot({path:'/tmp/les-18-bornes-firebase-mobile.png',fullPage:true});
  await page.locator('#new-race-form [name=name]').fill('Paris 2027');await page.locator('#new-race-form button').first().click();
  await page.waitForFunction(()=>document.querySelector('#race-select')?.selectedOptions[0]?.textContent==='Paris 2027');
  assert.equal((await state(page)).runners.length,0);assert.equal((await state(page)).predictionCount,0);
  await page.selectOption('#race-select','1');await page.locator('.admin-runner').first().waitFor();
  await page.locator('#settings-form [name=closed]').check();await page.locator('#settings-form button').click();
  await page.locator('#confirm-dialog button[value=yes]').click();await page.locator('#results-form').waitFor();
  for(let i=0;i<3;i++){
    const row=page.locator('[data-result]').nth(i);await row.locator('select').selectOption(i===2?'dnf':'finished');
    if(i<2){await row.locator('.pos-input').fill(String(i+1));await row.locator('.time-input').fill(i===0?'03:40':'03:50');}
  }
  await page.locator('#results-form .admin-actions button').first().click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Résultats enregistrés'));
  assert.equal((await state(alice)).runners[0].time,null);
  await page.getByRole('button',{name:'Publier les classements',exact:true}).click();
  await page.locator('#confirm-dialog button[value=yes]').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('classements sont publiés'));
  await alice.reload();await alice.getByRole('navigation').getByRole('button',{name:'Les classements',exact:true}).click();
  await alice.locator('.score-row').waitFor();
  assert.equal(await alice.locator('.score-value').innerText(),'0\npoints d’écart');
  await alice.getByRole('button',{name:/Les chronos/}).click();
  assert.equal(await alice.locator('.score-value').innerText(),'10\nmin d’écart moyen');
  await alice.getByRole('button',{name:'Les pronostics',exact:true}).click();await alice.locator('details summary').click();
  assert.equal(await alice.locator('.prediction-detail li').count(),3);
  assert.equal((await state(alice)).settings.closed,true);
  assert.equal((await state(alice)).predictions.length,1);
  await page.screenshot({path:'/tmp/les-18-bornes-firebase-admin.png',fullPage:true});
  const exported=await page.evaluate(async()=>{const m=await import('/firebase-adapter.js');return m.firebaseRequest('/api/admin/export',{},1);});
  assert.equal(exported.predictions.length,1);
  assert.deepEqual(errors,[]);
  console.log('Firebase navigateur : Auth pseudo/mot de passe, rôles, photo sans Storage, pronostic persistant, confidentialité, courses, clôture, résultats, export et deux scores validés sur ordinateur et mobile.');
}finally{
  if(browser)await browser.close();
  await adminAuth.deleteUser(coach.uid).catch(()=>{});await env.cleanup();
}
