// Optional browser check: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/browser-smoke.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const { chromium }=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=resolve(import.meta.dirname,'..');
const data=await mkdtemp(resolve(tmpdir(),'bornes-browser-'));
const env={...process.env,DATA_DIR:data,ADMIN_PASSWORD:'mot-de-passe-navigateur-test',NODE_ENV:'test'};
const bootstrap=spawnSync(process.execPath,['admin.js','Coach'],{cwd:root,env,encoding:'utf8'});
assert.equal(bootstrap.status,0,bootstrap.stderr);
const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
const base=`http://127.0.0.1:${port}`;
const server=spawn(process.execPath,['server.js'],{cwd:root,env:{...env,HOST:'127.0.0.1',PORT:String(port),APP_ORIGIN:base},stdio:['ignore','pipe','pipe']});
let browser;
try{
  await once(server.stdout,'data');
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1440,height:1050}});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base);
  await page.getByRole('button',{name:/Se connecter/}).first().click();
  await page.locator('#auth-form [name=username]').fill('Coach');
  await page.locator('#auth-form [name=password]').fill(env.ADMIN_PASSWORD);
  await page.locator('#auth-form button[type=submit], #auth-form button:not([type])').click();
  await page.getByRole('button',{name:'Administration',exact:true}).click();
  for(const name of ['Camille','Nico','Sam']){
    await page.locator('#add-runner-form input').fill(name);
    await page.locator('#add-runner-form button').click();
    await page.locator(`.admin-runner input[value="${name}"]`).waitFor();
  }
  assert.equal(await page.locator('.admin-runner').count(),3);
  // Verify Paris conversion on the daylight saving change date.
  assert.equal(await page.locator('[name=startsAt]').inputValue(),'2026-10-25T09:00');
  await page.locator('#settings-form button').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent==='Réglages enregistrés.');
  let s=await (await context.request.get(`${base}/api/state`)).json();
  assert.equal(s.settings.starts_at,'2026-10-25T08:00:00.000Z');
  await page.getByRole('button',{name:'Mes pronostics',exact:true}).click();
  await page.locator('[data-time]').first().waitFor();
  await page.locator('[data-time]').nth(0).fill('03:30');
  await page.locator('[data-time]').nth(1).fill('04:00');
  await page.locator('[data-time]').nth(2).fill('04:30');
  const original=await page.locator('.runner-row').first().getAttribute('data-runner');
  await page.locator('.runner-row').first().getByRole('button',{name:/Descendre/}).click();
  assert.notEqual(await page.locator('.runner-row').first().getAttribute('data-runner'),original);
  // Drag the same runner back to the front.
  await page.locator('.runner-row').nth(1).locator('.drag-handle').dragTo(page.locator('.runner-row').first());
  assert.equal(await page.locator('.runner-row').first().getAttribute('data-runner'),original);
  await page.locator('#prediction-form button[type=submit]').click();
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('Enregistré'));
  await page.reload();
  await page.locator('#prediction-form').waitFor();
  assert.equal(await page.locator('[data-time]').first().inputValue(),'03:30');
  await page.screenshot({path:'/tmp/les-18-bornes-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'/tmp/les-18-bornes-mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().right>innerWidth+1).map(el=>({tag:el.tagName,cls:el.className,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})));
  if(overflow.length)console.log(overflow);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Débordement horizontal sur mobile');
  await page.getByRole('button',{name:'Les pronostics',exact:true}).click();
  await page.getByRole('heading',{name:'Chacun garde son petit secret.'}).waitFor();
  await page.getByRole('button',{name:'Administration',exact:true}).click();
  await page.locator('#new-race-form [name=name]').fill('Marathon de Paris');
  await page.locator('#new-race-form button').first().click();
  await page.waitForFunction(()=>document.querySelector('#race-select')?.selectedOptions[0]?.textContent==='Marathon de Paris');
  assert.equal(await page.locator('.admin-runner').count(),0);
  const newRaceId=new URL(page.url()).searchParams.get('race');assert.ok(Number(newRaceId)>1);
  await page.selectOption('#race-select','1');
  await page.locator('.admin-runner').first().waitFor();
  // Manually close, reveal, then enter and publish results through the UI.
  await page.locator('#settings-form [name=closed]').check();
  await page.locator('#settings-form button').click();
  await page.locator('#confirm-dialog button[value=yes]').click();
  await page.locator('#results-form').waitFor();
  const rows=page.locator('[data-result]');
  for(let i=0;i<3;i++){
    const row=rows.nth(i);await row.locator('select').selectOption(i===2?'dnf':'finished');
    if(i<2){await row.locator('.pos-input').fill(String(i+1));await row.locator('.time-input').fill(i===0?'03:40':'03:50');}
  }
  await page.locator('#results-form > .admin-actions > button').first().click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Résultats enregistrés'));
  await page.getByRole('button',{name:'Publier les classements',exact:true}).click();
  await page.locator('#confirm-dialog button[value=yes]').click();
  await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('classements sont publiés'));
  await page.getByRole('button',{name:'Les classements',exact:true}).click();
  await page.locator('.score-row').waitFor();
  assert.equal(await page.locator('.score-value').first().innerText(),'0\npoints d’écart');
  await page.getByRole('button',{name:/Les chronos/}).click();
  assert.equal(await page.locator('.score-value').first().innerText(),'10\nmin d’écart moyen');
  await page.getByRole('button',{name:'Les pronostics',exact:true}).click();
  await page.locator('details summary').click();
  assert.equal(await page.locator('.prediction-detail li').count(),3);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log('Navigateur : connexion admin, coureurs, heure de Paris, tri par boutons et glisser-déposer, pronostic persistant, confidentialité, multi-courses, résultats et deux classements OK. Écrans 1440 et 390 px sans débordement.');
}finally{
  if(browser)await browser.close();
  server.kill('SIGTERM');await once(server,'exit');await rm(data,{recursive:true,force:true});
}
