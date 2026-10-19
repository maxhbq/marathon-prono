import { build } from 'esbuild';
import { readFile, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

export async function configuration() {
  const file=await readFile(resolve('.env'),'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
  const env={...parseEnv(file),...process.env};
  const keys={apiKey:'FIREBASE_API_KEY',authDomain:'FIREBASE_AUTH_DOMAIN',projectId:'FIREBASE_PROJECT_ID',appId:'FIREBASE_APP_ID'};
  const config={};
  for(const [key,name] of Object.entries(keys)){
    if(!env[name]?.trim())throw new Error(`Complète ${name} dans .env (voir .env.example).`);
    config[key]=env[name].trim();
  }
  if(!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(config.projectId))throw new Error('FIREBASE_PROJECT_ID invalide.');
  if(!/^[A-Za-z0-9.-]+$/.test(config.authDomain))throw new Error('FIREBASE_AUTH_DOMAIN doit être un nom d’hôte, sans https:// ni chemin.');
  if(env.FIREBASE_MESSAGING_SENDER_ID)config.messagingSenderId=env.FIREBASE_MESSAGING_SENDER_ID;
  config.emulators=env.FIREBASE_USE_EMULATORS==='true';
  const site=env.FIREBASE_HOSTING_SITE?.trim()||config.projectId;
  if(!/^[a-z0-9-]+$/.test(site))throw new Error('FIREBASE_HOSTING_SITE invalide.');
  return {config,site};
}

if(process.argv[1]===import.meta.filename){
  const {config,site}=process.argv.includes('--demo')?{config:{apiKey:'demo-key',authDomain:'demo-les18-bornes.firebaseapp.com',projectId:'demo-les18-bornes',appId:'1:123456789:web:demo',emulators:true},site:'demo-les18-bornes'}:await configuration();
  if(!process.argv.includes('--demo')&&(config.emulators||config.projectId.startsWith('demo-')))throw new Error('Pour les émulateurs, utiliser npm run firebase:build:demo. Une construction de publication doit cibler un vrai projet sans émulateurs.');
  await rm('dist',{recursive:true,force:true});await mkdir('dist');
  await cp('public','dist',{recursive:true});
  await writeFile('dist/firebase-config.js',`// Configuration publique Firebase, générée depuis .env.\nwindow.BORNES_FIREBASE = ${JSON.stringify(config)};\n`);
  await build({entryPoints:['firebase/client.js'],outfile:'dist/firebase-adapter.js',bundle:true,format:'esm',target:['es2022'],minify:true,sourcemap:false,legalComments:'none'});
  const fb=JSON.parse(await readFile('firebase.json','utf8'));
  fb.hosting.site=site;
  if(config.emulators){
    const csp=fb.hosting.headers.flatMap(h=>h.headers).find(h=>h.key==='Content-Security-Policy');
    csp.value=csp.value.replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:9099 http://127.0.0.1:8080");
  }
  await writeFile('.firebase-deploy.json',JSON.stringify(fb,null,2)+'\n');
  console.log(`Site Firebase construit pour ${config.projectId}. Mode ${config.emulators?'ÉMULATEURS (non publiable)':'production'}.`);
}
