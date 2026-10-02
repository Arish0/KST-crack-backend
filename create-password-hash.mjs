import {randomBytes,pbkdf2Sync} from 'node:crypto';
// Use a temporary environment variable; the plaintext password is never written.
const password=process.env.KST_ADMIN_PASSWORD;
if(!password||password.length<12)throw new Error('Set KST_ADMIN_PASSWORD to a password of at least 12 characters before running this script.');
const salt=randomBytes(16);const derived=pbkdf2Sync(password,salt,100000,32,'sha256');
process.stdout.write(salt.toString('hex')+':'+derived.toString('hex')+'\n');
