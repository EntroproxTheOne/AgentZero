// Local account recovery (run on the computer that has the app's data).
//   npx electron scripts/reset-password.mjs                 -> lists the accounts
//   npx electron scripts/reset-password.mjs <email> <new>   -> sets a new password
// Quit AgentZero first. The new password must be at least 8 characters.
import { app } from 'electron';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';

app.setName('agentzero');
const [email, password] = process.argv.slice(2).filter((arg) => !arg.endsWith('reset-password.mjs') && arg !== '.');

app.whenReady().then(() => {
  const db = new Database(path.join(app.getPath('userData'), 'agentzero.db'));
  try {
    if (!email) {
      for (const row of db.prepare('SELECT username, email, is_admin FROM Users ORDER BY id').all()) {
        console.log(`${row.is_admin ? 'admin ' : 'user  '} ${row.email} (${row.username})`);
      }
      return;
    }
    if (!password || password.length < 8) throw new Error('Give a new password of at least 8 characters.');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    const result = db.prepare('UPDATE Users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE lower(email) = lower(?)')
      .run(hash, salt, email.trim());
    console.log(result.changes ? `Password changed for ${email}.` : `No account with the email ${email}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    db.close();
    app.exit(process.exitCode ?? 0);
  }
});
