import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
export const cliEnv={...process.env,
  XDG_CONFIG_HOME:process.env.XDG_CONFIG_HOME||resolve('.data/firebase-cli'),
  FIREBASE_EMULATORS_PATH:process.env.FIREBASE_EMULATORS_PATH||'/tmp/les-18-bornes-firebase-emulators',
  FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true'};
mkdirSync(cliEnv.XDG_CONFIG_HOME,{recursive:true,mode:0o700});
if(process.argv[1]===import.meta.filename){
  const r=spawnSync(process.execPath,['node_modules/firebase-tools/lib/bin/firebase.js',...process.argv.slice(2)],{env:cliEnv,stdio:'inherit'});
  if(r.error)throw r.error;
  process.exit(r.status??1);
}
