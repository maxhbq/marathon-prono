import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { db, hashPassword } from './db.js';

const username = process.argv[2]?.trim();
if (!username || !/^[\p{L}\p{N}_ .-]{3,30}$/u.test(username)) {
  console.error('Usage : npm run admin -- "Pseudo" (3 à 30 caractères)');
  process.exit(1);
}
let password = process.env.ADMIN_PASSWORD;
if (!password && stdin.isTTY) {
  // Disable echo while readline still receives input.
  stdout.write('Mot de passe administrateur (12 caractères minimum) : ');
  const rl = createInterface({ input: stdin, terminal: false });
  stdin.setRawMode(true);
  password = await new Promise(resolve => {
    let value = '';
    const handler = chunk => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') process.exit(130);
        if (char === '\r' || char === '\n') {
          stdin.off('data', handler); stdin.setRawMode(false); rl.close(); stdout.write('\n'); resolve(value); return;
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0,-1); else value += char;
      }
    };
    stdin.on('data', handler);
  });
}
if (!password || password.length < 12 || password.length > 128) {
  console.error('Fournir un mot de passe de 12 à 128 caractères via le terminal ou ADMIN_PASSWORD.'); process.exit(1);
}
const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
if (existing) {
  db.prepare("UPDATE users SET password_hash=?,role='admin' WHERE id=?").run(hashPassword(password),existing.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(existing.id);
} else db.prepare("INSERT INTO users(username,password_hash,role) VALUES(?,?,'admin')").run(username,hashPassword(password));
console.log(`Compte administrateur « ${username} » prêt. Les sessions précédentes ont été révoquées.`);
db.close();
