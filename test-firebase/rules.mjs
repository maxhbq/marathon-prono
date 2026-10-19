import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, collection, setDoc, updateDoc, getDoc, getDocs, writeBatch, serverTimestamp, Timestamp } from 'firebase/firestore';

const projectId='demo-les18-bornes';
let env;
const race={id:1,race_name:'Lille',starts_at:Timestamp.fromDate(new Date('2099-10-25T08:00:00Z')),closed:false,published:false,roster_version:1,runner_ids:[1,2],prediction_count:0,submission_count:0,next_runner_id:3};
const database=uid=>uid?env.authenticatedContext(uid,{email:`${uid}@pseudos.invalid`}).firestore():env.unauthenticatedContext().firestore();
const ref=(db,path)=>doc(db,path);
before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{host:'127.0.0.1',port:8080,rules:await readFile('firestore.rules','utf8')}});});
after(async()=>{await env?.cleanup();});
beforeEach(async()=>{
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(ref(db,'admins/coach'),{enabled:true,created_at:serverTimestamp()});
    for(const uid of ['alice','bob','coach'])await setDoc(ref(db,`users/${uid}`),{username:uid,created_at:serverTimestamp()});
    await setDoc(ref(db,'races/1'),race);
    await setDoc(ref(db,'races/2'),{...race,id:2,race_name:'Paris',runner_ids:[3,4],next_runner_id:5});
    for(const id of [1,2])await setDoc(ref(db,`races/1/runners/${id}`),{id,name:`Coureur ${id}`,photo:null});
  });
});
async function submit(uid,overrides={},counts={prediction_count:1,submission_count:1}){
  const db=database(uid),batch=writeBatch(db);
  batch.set(ref(db,`races/1/predictions/${uid}`),{uid,username:uid,order:[1,2],times:'03:30,04:00,',roster_version:1,updated_at:serverTimestamp(),...overrides});
  batch.update(ref(db,'races/1'),counts);
  return batch.commit();
}
test('le public lit les courses et les coureurs, sans accès aux comptes ni aux résultats privés',async()=>{
  const db=database();
  await assertSucceeds(getDoc(ref(db,'races/1')));
  await assertSucceeds(getDocs(collection(db,'races/1/runners')));
  await assertFails(getDocs(collection(db,'users')));
  await assertFails(getDoc(ref(db,'users/alice')));
  await assertFails(getDoc(ref(db,'races/1/private/results')));
  await assertFails(getDocs(collection(db,'admins')));
});
test('les profils sont liés au pseudo authentifié et ne peuvent pas créer de droits admin',async()=>{
  const db=database('nouveau');
  await assertSucceeds(setDoc(ref(db,'users/nouveau'),{username:'Nouveau',created_at:serverTimestamp()}));
  await assertFails(setDoc(ref(db,'users/nouveau'),{username:'Autre',created_at:serverTimestamp()}));
  await assertFails(setDoc(ref(db,'admins/nouveau'),{role:'admin'}));
  const fake=database('faux');
  await assertFails(setDoc(ref(fake,'users/faux'),{username:'faux',role:'admin',created_at:serverTimestamp()}));
  await assertFails(setDoc(ref(fake,'users/faux'),{username:'victime',created_at:serverTimestamp()}));
  await assertSucceeds(getDoc(ref(db,'users/nouveau')));
  await assertFails(getDoc(ref(database('bob'),'users/nouveau')));
});
test('les utilisateurs ordinaires ne peuvent ni modifier la course ni écrire des résultats',async()=>{
  const db=database('alice');
  await assertFails(updateDoc(ref(db,'races/1'),{closed:true}));
  await assertFails(updateDoc(ref(db,'races/1'),{published:true}));
  await assertFails(setDoc(ref(db,'races/1/private/results'),{items:[],updated_at:serverTimestamp()}));
  await assertSucceeds(updateDoc(ref(database('coach'),'races/1'),{race_name:'Nouveau nom'}));
});
test('désactiver un administrateur retire ses droits sans modifier le compte utilisateur',async()=>{
  await env.withSecurityRulesDisabled(async context=>updateDoc(ref(context.firestore(),'admins/coach'),{enabled:false}));
  await assertFails(updateDoc(ref(database('coach'),'races/1'),{race_name:'Interdit'}));
  await assertSucceeds(getDoc(ref(database('coach'),'users/coach')));
});
test('un pronostic complet est enregistré avec des compteurs cohérents',async()=>{
  await assertSucceeds(submit('alice'));
  await assertSucceeds(submit('bob',{}, {prediction_count:2,submission_count:2}));
  await assertSucceeds(submit('alice',{times:'03:40,04:10,'},{prediction_count:2,submission_count:2}));
  const s=await getDoc(ref(database(),'races/1'));
  assert.equal(s.data().prediction_count,2);assert.equal(s.data().submission_count,2);
});
test('aucune fuite avant la clôture, y compris via une requête directe ou un compte administrateur',async()=>{
  await submit('alice');
  await assertSucceeds(getDoc(ref(database('alice'),'races/1/predictions/alice')));
  for(const uid of [null,'bob','coach']){
    await assertFails(getDoc(ref(database(uid),'races/1/predictions/alice')));
    await assertFails(getDocs(collection(database(uid),'races/1/predictions')));
  }
});
test('les doublons, listes incomplètes, coureurs étrangers et mauvaises versions sont rejetés',async()=>{
  for(const override of [{order:[1,1]},{order:[1],times:'03:30,'},{order:[1,3]},{roster_version:0},{uid:'bob'},{username:'coach'}])await assertFails(submit('alice',override));
});
test('tous les chronos sont validés par les règles, pas seulement par l’interface',async()=>{
  for(const times of ['00:00,04:00,','24:01,04:00,','03:60,04:00,','3:30,04:00,','03:30,','03:30,04:00,05:00,','03:30:00,04:00,','abcdefabcdef'])await assertFails(submit('alice',{times}));
  await assertSucceeds(submit('alice',{times:'00:01,24:00,'}));
});
test('les compteurs ne peuvent pas être gonflés ou modifiés sans pronostic atomique',async()=>{
  await assertFails(updateDoc(ref(database('alice'),'races/1'),{prediction_count:50,submission_count:50}));
  await assertFails(submit('alice',{}, {prediction_count:2,submission_count:2}));
  const db=database('alice');
  await assertFails(setDoc(ref(db,'races/1/predictions/alice'),{uid:'alice',username:'alice',order:[1,2],times:'03:30,04:00,',roster_version:1,updated_at:serverTimestamp()}));
});
test('ni le compteur ni un pronostic ne peuvent changer les paramètres de la course',async()=>{
  const db=database('alice'),batch=writeBatch(db);
  batch.set(ref(db,'races/1/predictions/alice'),{uid:'alice',username:'alice',order:[1,2],times:'03:30,04:00,',roster_version:1,updated_at:serverTimestamp()});
  batch.update(ref(db,'races/1'),{prediction_count:1,submission_count:1,starts_at:null,roster_version:2});
  await assertFails(batch.commit());
});
test('la clôture automatique utilise l’heure serveur et interdit les modifications',async()=>{
  await submit('alice');
  await updateDoc(ref(database('coach'),'races/1'),{starts_at:Timestamp.fromDate(new Date('2000-01-01T00:00:00Z'))});
  await assertSucceeds(getDocs(collection(database(),'races/1/predictions')));
  await assertFails(submit('alice',{}, {prediction_count:1,submission_count:1}));
  await assertFails(submit('bob',{}, {prediction_count:2,submission_count:2}));
});
test('la clôture manuelle révèle les pronostics sans révéler les résultats en brouillon',async()=>{
  await submit('alice');const coach=database('coach');
  await updateDoc(ref(coach,'races/1'),{closed:true});
  await assertSucceeds(getDocs(collection(database('bob'),'races/1/predictions')));
  await assertSucceeds(setDoc(ref(coach,'races/1/private/results'),{items:[{runnerId:1,status:'finished',position:1,time:'03:40'},{runnerId:2,status:'dnf',position:null,time:null}],updated_at:serverTimestamp()}));
  await assertFails(getDoc(ref(database(),'races/1/private/results')));
  await assertSucceeds(getDoc(ref(coach,'races/1/private/results')));
  await updateDoc(ref(coach,'races/1'),{published:true});
  await assertSucceeds(getDoc(ref(database(),'races/1/private/results')));
  await assertFails(setDoc(ref(coach,'races/1/private/results'),{items:[],updated_at:serverTimestamp()}));
});
test('une revalidation incrémente le nombre valide sans recompter le même joueur',async()=>{
  await submit('alice');const coach=database('coach');
  await updateDoc(ref(coach,'races/1'),{roster_version:2,prediction_count:0});
  await assertFails(submit('alice',{}, {prediction_count:1,submission_count:1}));
  await assertSucceeds(submit('alice',{roster_version:2},{prediction_count:1,submission_count:1}));
});
test('une autre course ne donne accès ni aux prédictions ni aux résultats de Lille',async()=>{
  await submit('alice');const db=database('bob'),batch=writeBatch(db);
  batch.set(ref(db,'races/2/predictions/bob'),{uid:'bob',username:'bob',order:[1,2],times:'03:30,04:00,',roster_version:1,updated_at:serverTimestamp()});
  batch.update(ref(db,'races/2'),{prediction_count:1,submission_count:1});
  await assertFails(batch.commit());
  await updateDoc(ref(database('coach'),'races/2'),{closed:true,published:true});
  await assertFails(getDoc(ref(database('bob'),'races/1/predictions/alice')));
  await assertFails(getDoc(ref(database('bob'),'races/1/private/results')));
});
test('les photos ne peuvent être modifiées que par un admin et restent limitées en taille',async()=>{
  const db=database('coach');
  await assertFails(updateDoc(ref(database('alice'),'races/1/runners/1'),{photo:'data:image/jpeg;base64,YQ=='}));
  await assertFails(updateDoc(ref(db,'races/1/runners/1'),{photo:'data:image/svg+xml;base64,YQ=='}));
  await assertFails(updateDoc(ref(db,'races/1/runners/1'),{photo:'data:image/jpeg;base64,'+'A'.repeat(180000)}));
  await assertSucceeds(updateDoc(ref(db,'races/1/runners/1'),{photo:'data:image/jpeg;base64,YQ=='}));
  await updateDoc(ref(db,'races/1'),{closed:true});
  await assertSucceeds(updateDoc(ref(db,'races/1/runners/1'),{name:'Nom corrigé'}));
  await assertFails(setDoc(ref(db,'races/1/runners/3'),{id:3,name:'Trop tard',photo:null}));
});
