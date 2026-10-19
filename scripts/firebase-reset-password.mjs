// Local trusted administration only. Never bundled into Firebase Hosting.
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { configuration } from './firebase-build.mjs';
const {config}=await configuration();
const uid=process.argv[2];
if(!uid||uid.length>128)throw new Error('Usage : npm run firebase:reset-password -- UID_FIREBASE');
let password=process.env.ADMIN_PASSWORD;
if(!password&&stdin.isTTY){
  stdout.write('Nouveau mot de passe (12 caractères minimum, saisie masquée) : ');
  const rl=createInterface({input:stdin,terminal:false});stdin.setRawMode(true);
  password=await new Promise(resolve=>{
    let value='';const handler=chunk=>{for(const c of chunk.toString()){
      if(c==='\u0003')process.exit(130);
      if(c==='\r'||c==='\n'){stdin.off('data',handler);stdin.setRawMode(false);rl.close();stdout.write('\n');resolve(value);return;}
      if(c==='\u007f'||c==='\b')value=value.slice(0,-1);else value+=c;
    }};stdin.on('data',handler);
  });
}
if(!password||password.length<12||password.length>128)throw new Error('Mot de passe de 12 à 128 caractères requis, via le terminal ou ADMIN_PASSWORD injecté de manière sécurisée.');
const app=initializeApp({projectId:config.projectId,credential:applicationDefault()});
const auth=getAuth(app);
await auth.updateUser(uid,{password});await auth.revokeRefreshTokens(uid);
console.log('Mot de passe changé et renouvellement des sessions révoqué. Aucun mot de passe n’a été écrit dans un fichier.');
