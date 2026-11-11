import { mkdir, open, chmod, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const directory = process.argv[2];
if (!directory || !process.env.JAVA_HOME) throw Error('Usage: JAVA_HOME=... node scripts/android-signing-init.mjs <private-directory-outside-repository>');
const target = resolve(directory);
const repo = resolve('.');
if (target === repo || target.startsWith(repo + '/')) throw Error('Signing directory must be outside the repository.');
await mkdir(target, { recursive: true, mode: 0o700 }); await chmod(target, 0o700);
const store = join(target, 'canopy-release.p12');
try { await access(store); throw Error('Keystore already exists; never replace a release identity.'); } catch(e) { if (e.code !== 'ENOENT') throw e; }
const password = randomBytes(32).toString('base64url');
const file = await open(join(target, 'password'), 'wx', 0o600); await file.writeFile(password); await file.close();
const result = spawnSync(join(process.env.JAVA_HOME, 'bin/keytool'), ['-genkeypair', '-storetype', 'PKCS12', '-keystore', store, '-alias', 'canopy', '-keyalg', 'RSA', '-keysize', '3072', '-validity', '10000', '-dname', 'CN=Canopy Android Release', '-storepass:env', 'CANOPY_INIT_PASSWORD', '-keypass:env', 'CANOPY_INIT_PASSWORD'], { env: { ...process.env, CANOPY_INIT_PASSWORD: password }, encoding: 'utf8' });
if (result.status !== 0) throw Error('Keytool failed; inspect private directory before retrying.');
await chmod(store,0o600);
console.log('Created durable APK signing material in the specified private directory. Back it up securely; it is separate from the Nostr publisher identity.');
