import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, lstat, chmod } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
const destination=resolve(process.argv[2] || 'tmp/docs/handoffs/public-export');
// Explicit product/source allowlist: no local Git history, operational instructions or records.
const allowed = /^(src\/|public\/|tests\/|e2e\/|android\/(release-policy.json$|fonts\/|icon.png$|app\/(src\/|build.gradle$)|gradle\/wrapper\/|gradlew$|build.gradle$|settings.gradle$|gradle.properties$|README.md$|PARITY.md$|CHANGELOG.md$)|scripts\/(android-release.mjs|android-signing-init.mjs|export-public.mjs|zapstore-release.ts|certificate-owner-guard(\.test)?\.ts)$|\.gitignore$|package(-lock)?\.json$|tsconfig(\.app|\.node)?\.json$|vite.config.ts$|playwright.config.ts$|index.html$|server.mjs$|nginx.conf$|Dockerfile$|README.md$|zapstore.yaml$)/;
if (destination===resolve('.')) throw Error('Export must be separate from source.');
const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(p=>allowed.test(p));
await mkdir(destination,{recursive:true});
for(const file of files) {
  if ((await lstat(file)).isSymbolicLink()) throw Error('Review symlink before export: '+file);
  const target=resolve(destination,file); await mkdir(dirname(target),{recursive:true}); await copyFile(file,target); await chmod(target,(await lstat(file)).mode & 0o777);
}
console.log(JSON.stringify({destination,files},null,2));
