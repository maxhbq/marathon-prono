import { backup } from 'node:sqlite';
import { mkdir, cp, stat } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { db, dataDir } from './db.js';

const destination=process.argv[2] && resolve(process.argv[2]);
if(!destination || destination===dataDir || destination.startsWith(dataDir+sep)) {
  console.error('Usage : npm run backup -- /chemin/hors-du-dossier-de-donnees/sauvegarde-neuve');process.exit(1);
}
try {
  await stat(destination);
  throw new Error('Le dossier existe déjà. Utilise un nouveau dossier pour préserver les sauvegardes.');
} catch(e) { if(e.code!=='ENOENT') throw e; }
await mkdir(destination,{recursive:true,mode:0o700});
await backup(db,join(destination,'marathon.sqlite'));
try{await cp(join(dataDir,'uploads'),join(destination,'uploads'),{recursive:true,errorOnExist:true,force:false});}catch(e){if(e.code!=='ENOENT')throw e;}
db.close();
console.log('Sauvegarde SQLite et photos terminée. Conserve ce dossier dans un emplacement privé.');
