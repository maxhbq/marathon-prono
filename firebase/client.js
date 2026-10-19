import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, collection, getDoc, setDoc, updateDoc, runTransaction, serverTimestamp, Timestamp, onSnapshot } from 'firebase/firestore';
import { minutes, clock, validatePrediction, scorePrediction, ranked } from '../domain.js';

const config=window.BORNES_FIREBASE;
const app=initializeApp(config);
const auth=getAuth(app), db=getFirestore(app);
if(config.emulators){
  connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
  connectFirestoreEmulator(db,'127.0.0.1',8080);
}
await auth.authStateReady();
const memo=new Map();
let activeRace=null,activeUser=null,wasClosed=null;
function clearCache(){for(const entry of memo.values())entry.stop();memo.clear();}
// Live listeners deliver only changes. Polling the interface does not reread every runner every 15 seconds.
async function watch(ref,isCollection=false){
  const key=`${isCollection?'c':'d'}:${ref.path}`;
  let entry=memo.get(key);
  if(!entry){
    entry={};memo.set(key,entry);
    entry.ready=new Promise((resolve,reject)=>{
      entry.stop=onSnapshot(ref,snapshot=>{entry.value=snapshot;entry.error=null;resolve();},error=>{entry.error=error;reject(error);});
    });
  }
  await entry.ready;if(entry.error)throw entry.error;return entry.value;
}
const readDoc=ref=>watch(ref);
const readCollection=ref=>watch(ref,true);
const raceRef=id=>doc(db,'races',String(id));
const runnerRef=(id,runner)=>doc(db,'races',String(id),'runners',String(runner));
const resultsRef=id=>doc(db,'races',String(id),'private','results');
const predictionRef=(id,uid)=>doc(db,'races',String(id),'predictions',uid);
const isClosed=s=>!!s.closed||!!(s.starts_at&&Date.now()>=s.starts_at.toMillis());
const baseRace=(id,name='Marathon de Lille')=>({id,race_name:name,starts_at:id===1?Timestamp.fromDate(new Date('2026-10-25T08:00:00Z')):null,closed:false,published:false,roster_version:1,runner_ids:[],prediction_count:0,submission_count:0,next_runner_id:1});
const error=message=>{throw new Error(message);};
async function userView(){
  const u=auth.currentUser;if(!u)return null;
  const [profile,admin]=await Promise.all([readDoc(doc(db,'users',u.uid)),readDoc(doc(db,'admins',u.uid))]);
  return {id:u.uid,username:profile.exists()?profile.data().username:u.email.split('@')[0],role:admin.exists()&&admin.data().enabled===true?'admin':'user'};
}
async function requireAdmin(){const u=await userView();if(u?.role!=='admin')error('Accès réservé à l’administration.');return u;}
function toItems(p){return p.order.map((runnerId,i)=>({runnerId,time:p.times.slice(i*6,i*6+5)}));}
function scoreItems(p){return toItems(p).map(i=>({runnerId:i.runnerId,minutes:minutes(i.time)}));}
async function getState(id){
  const uid=auth.currentUser?.uid||null;
  if(id!==activeRace||uid!==activeUser){clearCache();activeRace=id;activeUser=uid;wasClosed=null;}
  const user=await userView();
  let snapshot=await readDoc(raceRef(id));
  if(!snapshot.exists()&&id===1&&user?.role==='admin'){
    await runTransaction(db,async tx=>{const current=await tx.get(raceRef(1));if(!current.exists())tx.set(raceRef(1),baseRace(1));});
    clearCache();snapshot=await readDoc(raceRef(1));
  }
  if(!snapshot.exists()&&id!==1)error('Course introuvable.');
  const s=snapshot.exists()?snapshot.data():baseRace(1);
  const closed=isClosed(s);
  if(wasClosed!==null&&wasClosed!==closed)clearCache();
  wasClosed=closed;
  const [allRaces,allRunners]=await Promise.all([readCollection(collection(db,'races')),readCollection(collection(db,'races',String(id),'runners'))]);
  const rs=allRunners.docs.map(d=>d.data()).sort((a,b)=>a.id-b.id);
  let real=[];
  if(user?.role==='admin'||s.published){const result=await readDoc(resultsRef(id));real=result.exists()?result.data().items:[];}
  const realMap=new Map(real.map(r=>[r.runnerId,r]));
  const runners=rs.map(r=>{
    const result=realMap.get(r.id);
    return {...r,status:result?.status||'pending',result_position:result?.position||null,result_minutes:result?.time?minutes(result.time):null,time:result?.time||null};
  });
  let own=null,rows=[];
  if(user){const p=await readDoc(predictionRef(id,user.id));if(p.exists())own=p.data();}
  if(closed){const all=await readCollection(collection(db,'races',String(id),'predictions'));rows=all.docs.map(d=>d.data()).filter(p=>p.roster_version===s.roster_version);}
  const scores=s.published?rows.map(p=>{const score=scorePrediction(scoreItems(p),runners);return score?{userId:p.uid,username:p.username,...score}:null;}).filter(Boolean):[];
  const races=allRaces.docs.map(d=>{const r=d.data();return{id:r.id,race_name:r.race_name,starts_at:r.starts_at?.toDate().toISOString()||null,published:r.published};}).sort((a,b)=>b.id-a.id);
  if(!races.length)races.push({id:1,race_name:s.race_name,starts_at:s.starts_at?.toDate().toISOString()||null,published:false});
  let totalUsers=0;
  if(user?.role==='admin')totalUsers=(await readCollection(collection(db,'users'))).size;
  return {user,races,settings:{id:s.id,race_name:s.race_name,starts_at:s.starts_at?.toDate().toISOString()||null,closed,published:s.published,roster_version:s.roster_version,configured:rs.length>=2},runners,
    predictionCount:s.prediction_count,myPrediction:own?{items:toItems(own),updatedAt:own.updated_at?.toDate().toISOString()||new Date().toISOString(),valid:own.roster_version===s.roster_version}:null,
    predictions:closed?rows.map(p=>({userId:p.uid,username:p.username,items:toItems(p)})):[],
    leaderboards:{position:ranked(scores,'position'),time:ranked(scores,'time')},
    admin:user?.role==='admin'?{totalUsers,stalePredictions:s.submission_count-s.prediction_count,closedManually:s.closed}:null,serverTime:new Date().toISOString()};
}
async function compressedPhoto(data){
  if(typeof data!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(data)||data.length>2800000)error('Photo JPEG, PNG ou WebP de 2 Mo maximum requise.');
  const binary=atob(data.split(',')[1]);const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));const blob=new Blob([bytes],{type:data.slice(5,data.indexOf(';'))});const image=await createImageBitmap(blob);
  const scale=Math.min(1,256/Math.max(image.width,image.height));
  const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);image.close();
  const value=canvas.toDataURL('image/jpeg',.78);if(value.length>180000)error('La photo reste trop volumineuse après compression.');return value;
}
function credentials(input){
  const username=typeof input.username==='string'?input.username.trim():'';
  if(!/^[A-Za-z0-9_.-]{3,30}$/.test(username))error('Pseudo : 3 à 30 lettres sans accents, chiffres, points, tirets ou underscores.');
  if(typeof input.password!=='string'||input.password.length<12||input.password.length>128)error('Le mot de passe doit contenir 12 à 128 caractères.');
  return {username,email:`${username.toLowerCase()}@pseudos.invalid`,password:input.password};
}
async function handle(path,options,id){
  const method=options.method||'GET',input=options.body||{};
  if(path==='/api/state')return getState(id);
  if(path==='/api/login'||path==='/api/register'){
    const c=credentials(input);
    const result=path==='/api/register'?await createUserWithEmailAndPassword(auth,c.email,c.password):await signInWithEmailAndPassword(auth,c.email,c.password);
    const profile=doc(db,'users',result.user.uid);
    if(!(await getDoc(profile)).exists())await setDoc(profile,{username:c.username,created_at:serverTimestamp()});
    return {ok:true};
  }
  if(path==='/api/logout'){await signOut(auth);return {ok:true};}
  if(path==='/api/prediction'&&method==='PUT'){
    const user=await userView();if(!user)error('Connecte-toi pour continuer.');
    const rs=(await readCollection(collection(db,'races',String(id),'runners'))).docs.map(d=>d.data());
    const validation=validatePrediction(input.items,rs);if(validation)error(validation);
    await runTransaction(db,async tx=>{
      const [race,previous]=await Promise.all([tx.get(raceRef(id)),tx.get(predictionRef(id,user.id))]);
      const s=race.data();if(isClosed(s))error('Les pronostics sont clôturés.');
      if(input.rosterVersion!==s.roster_version)error('La liste a changé. Actualise puis revalide ton pronostic.');
      const valid=previous.exists()&&previous.data().roster_version===s.roster_version;
      tx.set(predictionRef(id,user.id),{uid:user.id,username:user.username,order:input.items.map(i=>i.runnerId),times:input.items.map(i=>`${i.time},`).join(''),roster_version:s.roster_version,updated_at:serverTimestamp()});
      tx.update(raceRef(id),{prediction_count:s.prediction_count+(valid?0:1),submission_count:s.submission_count+(previous.exists()?0:1)});
    });return {ok:true};
  }
  await requireAdmin();
  if(path==='/api/admin/races'&&method==='POST'){
    const name=input.name?.trim();if(!name||name.length>80)error('Nom de course invalide.');
    const raceId=Date.now();await runTransaction(db,async tx=>{const ref=raceRef(raceId);if((await tx.get(ref)).exists())error('Réessaie de créer la course.');tx.set(ref,baseRace(raceId,name));});return {ok:true,raceId};
  }
  if(path==='/api/admin/settings'&&method==='PUT'){
    const name=input.raceName?.trim(),date=input.startsAt?new Date(input.startsAt):null;
    if(!name||name.length>80||date&&!Number.isFinite(date.getTime())||typeof input.closed!=='boolean')error('Réglages invalides.');
    await runTransaction(db,async tx=>{const ref=raceRef(id),s=(await tx.get(ref)).data();if(s.published)error('Retire la publication avant de modifier les réglages.');tx.update(ref,{race_name:name,starts_at:date?Timestamp.fromDate(date):null,closed:input.closed});});return {ok:true};
  }
  if(path==='/api/admin/runners'&&method==='POST'){
    const name=input.name?.trim();if(!name||name.length>60)error('Nom de coureur invalide.');
    await runTransaction(db,async tx=>{const ref=raceRef(id),s=(await tx.get(ref)).data();if(isClosed(s))error('La liste est verrouillée après la clôture.');if(s.runner_ids.length>=100)error('100 coureurs maximum.');const rid=s.next_runner_id;tx.set(runnerRef(id,rid),{id:rid,name,photo:null});tx.update(ref,{runner_ids:[...s.runner_ids,rid],next_runner_id:rid+1,roster_version:s.roster_version+1,prediction_count:0});});return {ok:true};
  }
  const runner=/^\/api\/admin\/runners\/(\d+)(\/photo)?$/.exec(path);
  if(runner){
    const rid=Number(runner[1]),ref=runnerRef(id,rid);
    if(runner[2]&&method==='POST'){const photo=await compressedPhoto(input.data);await updateDoc(ref,{photo});return {ok:true};}
    await runTransaction(db,async tx=>{
      const [race,current]=await Promise.all([tx.get(raceRef(id)),tx.get(ref)]);if(!current.exists())error('Coureur introuvable.');const s=race.data();
      if(method==='DELETE'){if(isClosed(s))error('La liste est verrouillée.');tx.delete(ref);tx.update(raceRef(id),{runner_ids:s.runner_ids.filter(n=>n!==rid),roster_version:s.roster_version+1,prediction_count:0});}
      else if(method==='PUT'){const name=input.name?.trim();if(!name||name.length>60)error('Nom invalide.');tx.update(ref,{name});}else error('Action inconnue.');
    });return {ok:true};
  }
  if(path==='/api/admin/results'&&method==='PUT'){
    await runTransaction(db,async tx=>{
      const s=(await tx.get(raceRef(id))).data();if(!isClosed(s)||s.published)error('Clôture les pronostics et retire la publication avant de saisir les résultats.');
      if(!Array.isArray(input.items)||input.items.length!==s.runner_ids.length)error('Un résultat est requis par coureur.');
      const ids=new Set(s.runner_ids),positions=[];
      const items=input.items.map(i=>{
        if(!ids.delete(i.runnerId)||!['pending','finished','dnf','dns'].includes(i.status))error('Résultat invalide.');
        if(i.status==='finished'){if(minutes(i.time)===null||!Number.isInteger(i.position)||i.position<1)error('Temps et position requis pour les arrivants.');positions.push(i.position);return {runnerId:i.runnerId,status:i.status,time:i.time,position:i.position};}
        return {runnerId:i.runnerId,status:i.status,time:null,position:null};
      });
      if(positions.sort((a,b)=>a-b).some((p,i)=>p!==i+1))error('Positions consécutives requises : 1, 2, 3… sans doublon.');
      tx.set(resultsRef(id),{items,updated_at:serverTimestamp()});
    });return {ok:true};
  }
  if(path==='/api/admin/publish'&&method==='POST'){
    if(typeof input.published!=='boolean')error('Publication invalide.');
    await runTransaction(db,async tx=>{const [race,results]=await Promise.all([tx.get(raceRef(id)),tx.get(resultsRef(id))]);const s=race.data(),items=results.exists()?results.data().items:[];if(input.published&&(!isClosed(s)||items.length<2||items.length!==s.runner_ids.length||items.some(r=>r.status==='pending')||!items.some(r=>r.status==='finished')))error('Renseigne tous les résultats avec au moins un arrivant avant de publier.');tx.update(raceRef(id),{published:input.published});});return {ok:true};
  }
  if(path==='/api/admin/users')return (await readCollection(collection(db,'users'))).docs.map(d=>({id:d.id,username:d.data().username,role:d.id===auth.currentUser.uid?'admin':'user'}));
  if(path==='/api/admin/export'){const state=await getState(id);return {exportedAt:new Date().toISOString(),settings:state.settings,runners:state.runners,predictions:state.settings.closed?state.predictions:[],note:state.settings.closed?'':'Les pronostics restent secrets avant la clôture et ne sont pas exportés.'};}
  if(path==='/api/admin/password')error('Sur Firebase, la récupération du mot de passe se fait via un outil administrateur de confiance. Voir FIREBASE.md.');
  error('Action inconnue.');
}
const messages={
  'auth/email-already-in-use':'Ce pseudo est déjà utilisé.',
  'auth/invalid-credential':'Pseudo ou mot de passe incorrect.',
  'auth/user-not-found':'Pseudo ou mot de passe incorrect.',
  'auth/wrong-password':'Pseudo ou mot de passe incorrect.',
  'auth/invalid-login-credentials':'Pseudo ou mot de passe incorrect.',
  'auth/too-many-requests':'Trop de tentatives. Réessaie plus tard.',
  'auth/operation-not-allowed':'Active la connexion Email/Mot de passe dans Firebase Authentication.',
  'auth/network-request-failed':'Connexion à Firebase impossible. Vérifie le réseau et la configuration.',
  'auth/unauthorized-domain':'Ajoute ce domaine dans les domaines autorisés de Firebase Authentication.',
  'permission-denied':'Accès refusé par les règles Firestore. Vérifie les droits du compte et la clôture de la course.',
  'unavailable':'Firebase est temporairement inaccessible. Réessaie quand la connexion revient.'
};
export async function firebaseRequest(path,options,id){
  try{const result=await handle(path,options,id);if(options.method&&options.method!=='GET')clearCache();return result;}
  catch(e){throw new Error(messages[e.code]||e.message||'La requête Firebase a échoué.');}
}
