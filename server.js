import http from 'node:http';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { db, dataDir, hashPassword, verifyPassword, transaction } from './db.js';
import { minutes, clock, validatePrediction, scorePrediction, ranked } from './domain.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const production = process.env.NODE_ENV === 'production';
const publicDir = resolve(import.meta.dirname, 'public');
const uploadsDir = resolve(dataDir, 'uploads');
await mkdir(uploadsDir, { recursive: true, mode: 0o700 });
if (production && !process.env.APP_ORIGIN) throw new Error('APP_ORIGIN=https://votre-domaine est requis en production.');
const configuredOrigin = process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : null;
if (production && new URL(process.env.APP_ORIGIN).protocol !== 'https:') throw new Error('APP_ORIGIN doit utiliser HTTPS en production.');
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const userView = u => u ? { id:u.id, username:u.username, role:u.role } : null;
const raceSettings = id => db.prepare('SELECT * FROM settings WHERE id=?').get(id);
const raceRunners = id => db.prepare('SELECT * FROM runners WHERE race_id=? ORDER BY id').all(id);
const locked = s => !!s.closed || !!(s.starts_at && Date.now() >= Date.parse(s.starts_at));
const completeRoster = (s, rs) => rs.length >= 2;
const rateLimits = new Map();

function rateLimit(req, route, maximum=30) {
  const ip = req.socket.remoteAddress;
  const key = `${ip}:${route}`;
  const now = Date.now();
  let bucket = rateLimits.get(key);
  if (!bucket || now > bucket.reset) { bucket = { count:0, reset:now+15*60*1000 }; rateLimits.set(key,bucket); }
  if (++bucket.count > maximum) fail(429,'Trop de tentatives. Réessaie dans 15 minutes.');
  if (rateLimits.size > 5000) for (const [k,v] of rateLimits) if (v.reset < now) rateLimits.delete(k);
}
function auth(req) {
  const match = /(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  if (!match) return null;
  return db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires_at>?').get(digest(match[1]),Date.now());
}
function digest(token) { return createHash('sha256').update(token).digest('hex'); }
function session(res, id) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(digest(token),id,Date.now()+30*86400000);
  res.setHeader('Set-Cookie',`session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${production ? '; Secure' : ''}`);
}
function json(res, data, status=200) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
}
async function body(req, max=64*1024) {
  let size = 0; const chunks=[];
  for await (const chunk of req) { size += chunk.length; if (size > max) fail(413,'Fichier ou requête trop volumineux.'); chunks.push(chunk); }
  const buf=Buffer.concat(chunks);
  let parsed;
  try { parsed=JSON.parse(buf.toString()); } catch { fail(400,'JSON invalide.'); }
  if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) fail(400,'Un objet JSON est requis.');
  return parsed;
}
function requireUser(user) { if (!user) fail(401,'Connecte-toi pour continuer.'); }
function requireAdmin(user) { requireUser(user); if(user.role !== 'admin') fail(403,'Accès réservé à l’administration.'); }
function rosterChangeAllowed(s) {
  if (locked(s)) fail(409,'La course a commencé : la liste des coureurs est verrouillée.');
}
function publicRunner(r) { return { ...r, time:r.result_minutes ? clock(r.result_minutes) : null }; }
function resultData(user, raceId) {
  const s=raceSettings(raceId), rs=raceRunners(raceId);
  const reveal=locked(s);
  const rows=db.prepare('SELECT predictions.*,users.username FROM predictions JOIN users ON users.id=predictions.user_id WHERE predictions.race_id=?').all(raceId);
  const valid=rows.filter(p => p.roster_version===s.roster_version);
  const revealResults=!!s.published || user?.role==='admin';
  const scored = s.published ? valid.map(p => {
    const score=scorePrediction(JSON.parse(p.items),rs);
    return score ? { userId:p.user_id, username:p.username,...score } : null;
  }).filter(Boolean) : [];
  return {
    user:userView(user), races:db.prepare('SELECT id,race_name,starts_at,published FROM settings ORDER BY id DESC').all(), settings:{ id:s.id,race_name:s.race_name,starts_at:s.starts_at,closed:locked(s),published:!!s.published,roster_version:s.roster_version,configured:completeRoster(s,rs) },
    runners:rs.map(r => revealResults ? publicRunner(r) : {id:r.id,name:r.name,photo:r.photo,status:'pending',time:null,result_position:null}),
    predictionCount:valid.length,
    myPrediction:user ? (()=>{ const p=rows.find(p=>p.user_id===user.id); return p ? {items:JSON.parse(p.items).map(i=>({runnerId:i.runnerId,time:clock(i.minutes)})),updatedAt:p.updated_at,valid:p.roster_version===s.roster_version} : null; })() : null,
    predictions:reveal ? valid.map(p=>({userId:p.user_id,username:p.username,items:JSON.parse(p.items).map(i=>({runnerId:i.runnerId,time:clock(i.minutes)}))})) : [],
    leaderboards:{position:ranked(scored,'position'),time:ranked(scored,'time')},
    admin:user?.role==='admin' ? { totalUsers:db.prepare('SELECT count(*) AS n FROM users').get().n,stalePredictions:rows.length-valid.length,closedManually:!!s.closed } : null,
    serverTime:new Date().toISOString()
  };
}

async function api(req,res,path, raceId) {
  const user=auth(req);
  if(req.method==='POST' && path==='/api/admin/races') {
    requireAdmin(user); const input=await body(req);
    const name=typeof input.name==='string'?input.name.trim():'';
    if(!name || name.length>80) fail(400,'Nom de course requis (80 caractères maximum).');
    if(db.prepare('SELECT count(*) AS n FROM settings').get().n>=100) fail(400,'100 courses maximum.');
    const r=db.prepare('INSERT INTO settings(race_name) VALUES(?)').run(name);
    return json(res,{ok:true,raceId:Number(r.lastInsertRowid)},201);
  }
  if(!Number.isInteger(raceId) || !raceSettings(raceId)) fail(404,'Course introuvable.');
  const settings=()=>raceSettings(raceId);
  const runners=()=>raceRunners(raceId);
  if(req.method==='GET' && path==='/api/state') return json(res,resultData(user,raceId));
  if(req.method==='POST' && ['/api/login','/api/register'].includes(path)) {
    rateLimit(req,'auth',150); const input=await body(req);
    const username=typeof input.username==='string' ? input.username.trim().normalize('NFC') : '';
    const password=input.password;
    if(!/^[\p{L}\p{N}_ .-]{3,30}$/u.test(username) || typeof password!=='string' || password.length<12 || password.length>128) fail(400,'Pseudo de 3 à 30 caractères et mot de passe de 12 à 128 caractères requis.');
    rateLimit(req,`account:${digest(username.toLowerCase())}`,15);
    if(path==='/api/register') {
      if(db.prepare('SELECT id FROM users WHERE username=?').get(username)) fail(409,'Ce pseudo est déjà utilisé.');
      if(db.prepare('SELECT count(*) AS n FROM users').get().n >= 5000) fail(409,'La limite de comptes est atteinte.');
      const result=db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run(username,hashPassword(password));
      session(res,Number(result.lastInsertRowid)); return json(res,{ok:true},201);
    }
    const found=db.prepare('SELECT * FROM users WHERE username=?').get(username);
    const valid=verifyPassword(password,found?.password_hash);
    if(!found || !valid) fail(401,'Pseudo ou mot de passe incorrect.');
    session(res,found.id); return json(res,{ok:true});
  }
  if(req.method==='POST' && path==='/api/logout') {
    const match=/(?:^|;\s*)session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'');
    if(match) db.prepare('DELETE FROM sessions WHERE token=?').run(digest(match[1]));
    res.setHeader('Set-Cookie',`session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${production?'; Secure':''}`); return json(res,{ok:true});
  }
  if(req.method==='PUT' && path==='/api/prediction') {
    requireUser(user); const input=await body(req); const s=settings(),rs=runners();
    if(locked(s)) fail(409,'Les pronostics sont clôturés.');
    if(!completeRoster(s,rs)) fail(409,'L’organisateur doit ajouter au moins deux coureurs.');
    if(input.rosterVersion!==s.roster_version) fail(409,'La liste des coureurs a changé. Actualise la page avant de valider.');
    const error=validatePrediction(input.items,rs); if(error) fail(400,error);
    const items=input.items.map(i=>({runnerId:i.runnerId,minutes:minutes(i.time)}));
    db.prepare('INSERT INTO predictions(user_id,race_id,items,roster_version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,race_id) DO UPDATE SET items=excluded.items,roster_version=excluded.roster_version,updated_at=excluded.updated_at').run(user.id,raceId,JSON.stringify(items),s.roster_version,new Date().toISOString());
    return json(res,{ok:true});
  }
  if(!path.startsWith('/api/admin/')) fail(404,'Page introuvable.');
  requireAdmin(user);
  if(req.method==='PUT' && path==='/api/admin/settings') {
    const input=await body(req),s=settings();
    const name=typeof input.raceName==='string' ? input.raceName.trim() : '';
    if(!name || name.length>80) fail(400,'Nom de course requis (80 caractères maximum).');
    const starts=input.startsAt ? new Date(input.startsAt) : null;
    if(starts && !Number.isFinite(starts.getTime())) fail(400,'Date de départ invalide.');
    if(s.published) fail(409,'Retire la publication des résultats avant de modifier le départ.');
    if(typeof input.closed!=='boolean') fail(400,'État de clôture invalide.');
    db.prepare('UPDATE settings SET race_name=?,starts_at=?,closed=? WHERE id=?').run(name,starts?.toISOString() || null,input.closed?1:0,raceId);
    return json(res,{ok:true});
  }
  if(req.method==='POST' && path==='/api/admin/runners') {
    rosterChangeAllowed(settings()); const input=await body(req);
    const name=typeof input.name==='string' ? input.name.trim() : '';
    if(!name || name.length>60) fail(400,'Nom du coureur requis (60 caractères maximum).');
    if(runners().length>=100) fail(400,'100 coureurs maximum.');
    transaction(()=>{db.prepare('INSERT INTO runners(race_id,name) VALUES(?,?)').run(raceId,name);db.prepare('UPDATE settings SET roster_version=roster_version+1 WHERE id=?').run(raceId);});
    return json(res,{ok:true},201);
  }
  const runnerMatch=/^\/api\/admin\/runners\/(\d+)$/.exec(path);
  if(runnerMatch && ['PUT','DELETE'].includes(req.method)) {
    const id=Number(runnerMatch[1]); if(!db.prepare('SELECT id FROM runners WHERE id=? AND race_id=?').get(id,raceId)) fail(404,'Coureur introuvable.');
    if(req.method==='DELETE') {
      rosterChangeAllowed(settings()); transaction(()=>{db.prepare('DELETE FROM runners WHERE id=?').run(id); db.prepare('UPDATE settings SET roster_version=roster_version+1 WHERE id=?').run(raceId);});
    } else {
      const input=await body(req); const name=typeof input.name==='string' ? input.name.trim() : '';
      if(!name || name.length>60) fail(400,'Nom invalide.'); db.prepare('UPDATE runners SET name=? WHERE id=?').run(name,id);
    }
    return json(res,{ok:true});
  }
  const photoMatch=/^\/api\/admin\/runners\/(\d+)\/photo$/.exec(path);
  if(photoMatch && req.method==='POST') {
    const id=Number(photoMatch[1]); const runner=db.prepare('SELECT * FROM runners WHERE id=? AND race_id=?').get(id,raceId);
    if(!runner) fail(404,'Coureur introuvable.');
    const input=await body(req,3*1024*1024);
    const match=typeof input.data==='string' && /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(input.data);
    if(!match) fail(400,'Utilise une photo JPEG, PNG ou WebP.');
    const buf=Buffer.from(match[2],'base64'),kind=match[1];
    if(buf.length>2*1024*1024) fail(413,'Photo trop volumineuse : 2 Mo maximum.');
    const valid=(kind==='jpeg' && buf[0]===255 && buf[1]===216 && buf[2]===255) || (kind==='png' && buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) || (kind==='webp' && buf.toString('ascii',0,4)==='RIFF' && buf.toString('ascii',8,12)==='WEBP');
    if(!valid) fail(400,'Le fichier ne correspond pas au format annoncé.');
    const file=`${randomBytes(16).toString('hex')}.${kind}`;
    await writeFile(resolve(uploadsDir,file),buf,{mode:0o600});
    db.prepare('UPDATE runners SET photo=? WHERE id=?').run(`/uploads/${file}`,id);
    if(runner.photo) await unlink(resolve(uploadsDir,runner.photo.split('/').at(-1))).catch(()=>{});
    return json(res,{ok:true});
  }
  if(req.method==='PUT' && path==='/api/admin/results') {
    if(!locked(settings())) fail(409,'Clôture les pronostics avant de saisir les résultats.');
    if(settings().published) fail(409,'Retire la publication avant de corriger les résultats.');
    const input=await body(req),rs=runners();
    if(!Array.isArray(input.items) || input.items.length!==rs.length) fail(400,'Un résultat est requis pour chaque coureur.');
    const ids=new Set(rs.map(r=>r.id)); const places=[];
    const results=input.items.map(i=>{
      if(!i || !ids.delete(i.runnerId) || !['pending','finished','dnf','dns'].includes(i.status)) fail(400,'Résultat invalide.');
      if(i.status==='finished') {
        const m=minutes(i.time); if(m===null || !Number.isInteger(i.position) || i.position<1) fail(400,'Temps et position valides requis pour chaque arrivant.');
        places.push(i.position); return {...i,minutes:m};
      }
      return {...i,minutes:null,position:null};
    });
    places.sort((a,b)=>a-b); if(places.some((p,i)=>p!==i+1)) fail(400,'Les positions des arrivants doivent aller de 1 à leur nombre, sans doublon.');
    transaction(()=>{for(const r of results) db.prepare('UPDATE runners SET status=?,result_minutes=?,result_position=? WHERE id=?').run(r.status,r.minutes,r.position,r.runnerId);});
    return json(res,{ok:true});
  }
  if(req.method==='POST' && path==='/api/admin/publish') {
    const input=await body(req);
    if(typeof input.published!=='boolean') fail(400,'État de publication invalide.');
    if(input.published) {
      const rs=runners(); if(!locked(settings()) || rs.length<2 || rs.some(r=>r.status==='pending') || !rs.some(r=>r.status==='finished')) fail(409,'Clôture les pronostics et renseigne tous les résultats avec au moins un arrivant avant de publier.');
    }
    db.prepare('UPDATE settings SET published=? WHERE id=?').run(input.published?1:0,raceId); return json(res,{ok:true});
  }
  if(req.method==='POST' && path==='/api/admin/password') {
    const input=await body(req);
    if(!Number.isInteger(input.userId) || typeof input.password!=='string' || input.password.length<12 || input.password.length>128) fail(400,'Compte et mot de passe de 12 à 128 caractères requis.');
    const target=db.prepare('SELECT id,role FROM users WHERE id=?').get(input.userId);
    if(!target) fail(404,'Compte introuvable.');
    if(target.role==='admin' && target.id!==user.id) fail(403,'Utilise la commande administrateur pour un autre administrateur.');
    transaction(()=>{db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(input.password),target.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);});
    return json(res,{ok:true});
  }
  if(req.method==='GET' && path==='/api/admin/users') return json(res,db.prepare('SELECT id,username,role FROM users ORDER BY username').all());
  if(req.method==='GET' && path==='/api/admin/export') {
    const backup={exportedAt:new Date().toISOString(),settings:settings(),runners:runners(),predictions:db.prepare('SELECT users.username,predictions.* FROM predictions JOIN users ON users.id=predictions.user_id WHERE predictions.race_id=?').all(raceId).map(p=>({...p,items:JSON.parse(p.items)}))};
    res.setHeader('Content-Disposition','attachment; filename="les-18-bornes-export.json"'); return json(res,backup);
  }
  fail(404,'Page introuvable.');
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  res.setHeader('Cache-Control','no-store');
  if(production) res.setHeader('Strict-Transport-Security','max-age=31536000');
  try {
    const url=new URL(req.url,'http://localhost');
    const path=url.pathname;
    const raceId=Number(url.searchParams.get('race') || 1);
    if(path.startsWith('/api/')) {
      if(!['GET','HEAD'].includes(req.method)) {
        const expected=configuredOrigin || `http://${req.headers.host}`;
        if(req.headers.origin!==expected) fail(403,'Origine de la requête non autorisée.');
        if(!req.headers['content-type']?.startsWith('application/json')) fail(415,'Content-Type application/json requis.');
      }
      return await api(req,res,path,raceId);
    }
    if(!['GET','HEAD'].includes(req.method)) fail(405,'Méthode non autorisée.');
    let file;
    if(/^\/uploads\/[a-f0-9]{32}\.(jpeg|png|webp)$/.test(path)) file=resolve(uploadsDir,path.split('/').at(-1));
    else if(['/','/app.js','/styles.css','/favicon.svg','/firebase-config.js'].includes(path)) file=resolve(publicDir,path==='/'?'index.html':path.slice(1));
    else fail(404,'Page introuvable.');
    const content=await readFile(file).catch(()=>fail(404,'Fichier introuvable.'));
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'};
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}); res.end(req.method==='HEAD'?undefined:content);
  } catch(e) {
    if(!e.status) console.error('Erreur serveur :',e.message);
    if(!res.headersSent) json(res,{error:e.status?e.message:'Une erreur interne est survenue.'},e.status||500); else res.end();
  }
});
server.requestTimeout=15000;
server.headersTimeout=10000;
server.listen(port,host,()=>console.log(`Les 18 Bornes : port ${port}. Base SQLite prête.`));
for(const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
