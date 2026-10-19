import { spawn } from 'node:child_process';
import { existsSync, readFileSync, createWriteStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, join } from 'node:path';
import { once } from 'node:events';
import net from 'node:net';
import { cliEnv } from './firebase-cli.mjs';

const mode=process.argv[2]||'start';
if(!['start','test','browser'].includes(mode))throw new Error('Mode attendu : start, test ou browser.');
const jar=resolve('.data/firebase-emulators/gcloud-firestore-emulator.jar');
let java,cli,log;
const useSDK=existsSync(jar);
async function freePort(port){return new Promise(resolve=>{const socket=net.connect(port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));});}
try{
  if(useSDK){
    const verified=JSON.parse(readFileSync(join(dirname(jar),'verified.json'),'utf8'));
    const expected=JSON.parse(readFileSync('node_modules/firebase-tools/lib/emulator/downloadableEmulatorInfo.json','utf8')).firestore.version;
    if(verified.version!==expected||createHash('sha256').update(readFileSync(jar)).digest('hex')!==verified.jar_sha256)throw new Error('Émulateur SDK absent ou altéré : relancer npm run firebase:prepare-emulator.');
    if(!await freePort(8080))throw new Error('Le port 8080 est déjà occupé. Ne pas lancer deux émulateurs Firestore.');
    log=createWriteStream('.data/firebase-firestore.log',{flags:'a',mode:0o600});
    java=spawn('java',['-Duser.language=en','-cp',jar,'com.google.cloud.datastore.emulator.firestore.CloudFirestore','--host=127.0.0.1','--port=8080','--rules=firestore.rules','--project_id=demo-les18-bornes','--single_project_mode=true'],{stdio:['ignore','pipe','pipe']});
    java.stdout.pipe(log,{end:false});java.stderr.pipe(log,{end:false});
    java.once('error',e=>{console.error(e.message);});
    let ready=false;
    for(let i=0;i<100;i++){
      if(java.exitCode!==null)throw new Error('Échec de l’émulateur Firestore. Voir .data/firebase-firestore.log.');
      try{await fetch('http://127.0.0.1:8080/',{signal:AbortSignal.timeout(200)});ready=true;break;}catch{}
      await new Promise(r=>setTimeout(r,100));
    }
    if(!ready)throw new Error('Démarrage Firestore trop long. Voir .data/firebase-firestore.log.');
    console.log('Émulateur Firestore officiel Google Cloud SDK vérifié et démarré.');
  }
  const services=mode==='test'?['auth']:['auth','hosting'];
  if(!useSDK)services.push('firestore');
  const args=[mode==='start'?'emulators:start':'emulators:exec','--project','demo-les18-bornes','--only',services.join(',')];
  if(mode!=='test')args.push('--config','.firebase-deploy.json');
  if(mode==='test')args.push('node --test test-firebase/rules.mjs');
  if(mode==='browser')args.push('node scripts/firebase-browser-smoke.mjs');
  cli=spawn(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js',...args],{env:{...cliEnv,...(useSDK?{FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}:{})},stdio:'inherit'});
  const stop=()=>{cli?.kill('SIGINT');};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const [code]=await once(cli,'exit');process.exitCode=code??1;
}finally{
  if(java&&java.exitCode===null){java.kill('SIGTERM');await once(java,'exit');}
  log?.end();
}
