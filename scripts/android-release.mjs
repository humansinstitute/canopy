import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
const directory = process.env.CANOPY_SIGNING_DIRECTORY;
if (!directory) throw Error('Set CANOPY_SIGNING_DIRECTORY to the private signing directory.');
const root = resolve(directory);
for (const name of ['canopy-release.p12','password']) {
  const info = await stat(join(root,name));
  if (info.mode & 0o077) throw Error('Signing files must be readable by their owner only.');
}
const password = (await readFile(join(root,'password'),'utf8')).trim();
const result = spawnSync('./android/gradlew', ['-p','android','assembleRelease','testReleaseUnitTest','lintRelease','--console=plain'], { stdio:'inherit', env: { ...process.env, CANOPY_KEYSTORE: join(root,'canopy-release.p12'), CANOPY_STORE_PASSWORD: password } });
process.exit(result.status ?? 1);
