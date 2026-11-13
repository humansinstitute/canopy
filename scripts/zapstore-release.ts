/** Reviewed external signing adapter for zsp 0.4.17. Never reads Nostr secrets. */
import { createHash, X509Certificate, verify as verifyRSA } from 'node:crypto';
import { resolve } from 'node:path';
import { verifyEvent } from 'nostr-tools';
import { assertLegacyPublisherAllowed } from './certificate-owner-guard';
const root=process.env.AUTOPILOT_REPO;
if (!root) throw Error('AUTOPILOT_REPO must name the installed broker checkout.');
const {callCapabilityBroker, readCapabilityIdentity}=await import(resolve(root,'src/mcp/capability-client.ts'));
const policy=await Bun.file(new URL('../android/release-policy.json',import.meta.url)).json();
const publisher=policy.publisherHex; const pkg=policy.packageId; const repo=policy.repository;
const relay='wss://relay.zapstore.dev';
const [action, directory]=Bun.argv.slice(2); const run=resolve(directory);
type Event={kind:number;pubkey:string;created_at:number;content:string;tags:string[][];id?:string;sig?:string};
const tag=(e:Event,n:string)=>e.tags.find(t=>t[0]===n)?.[1];
const meta=await Bun.file(run+'/metadata.json').json();
if (meta.package_id!==pkg || !/^\d+\.\d+\.\d+$/.test(meta.version_name) || !Number.isSafeInteger(meta.version_code) || meta.version_code<1 || meta.certificate_hash!==policy.certificateSha256) throw Error('Release metadata identity mismatch.');
const version=meta.version_name; const publicBase=repo+'/releases/download/v'+version+'/';
function validate(e:Event) {
  const allowed:Record<number,string[]>={30509:['d','signature','expiry'],32267:['d','name','summary','icon','image','repository','f','h','t','license','website','url'],30063:['i','version','d','c','f','e','url'],3063:['i','x','version','url','m','size','f','min_platform_version','target_platform_version','filename','variant','commit','supported_nip','version_code','apk_certificate_hash']};
  if(e.pubkey!==publisher || !allowed[e.kind] || e.tags.some(t=>!allowed[e.kind].includes(t[0])) || e.content.length>32768)throw Error('Unexpected release template.');
  if(e.kind===30509) { if(tag(e,'d')!==meta.certificate_hash || e.content!=='' || Number(tag(e,'expiry'))<=e.created_at)throw Error('Invalid certificate proof.'); }
  else if(tag(e,e.kind===32267?'d':'i')!==pkg)throw Error('Foreign package.');
  if(e.kind===32267 && (tag(e,'name')!=='Canopy'||tag(e,'repository')!==repo))throw Error('Wrong application.');
  if(e.kind===30063 && (tag(e,'c')!=='main'||tag(e,'d')!==pkg+'@'+version||tag(e,'version')!==version))throw Error('Wrong release.');
  if(e.kind===3063 && (tag(e,'apk_certificate_hash')!==meta.certificate_hash||tag(e,'version_code')!==String(meta.version_code)||tag(e,'x')!==meta.hash||tag(e,'size')!==String(meta.size)))throw Error('Wrong APK.');
  for(const t of e.tags.filter(t=>['url','icon','image'].includes(t[0])))if(!(e.kind===32267&&t[0]==='url'&&t[1]===policy.website) && ![publicBase+'canopy-'+version+'.apk',publicBase+'icon.png'].includes(t[1]) && !/^https:\/\/cdn\.zapstore\.dev\/[a-f0-9]{64}(\?redirect=true)?$/.test(t[1]))throw Error('Unexpected asset URL.');
}
const ownerCheck=()=>assertLegacyPublisherAllowed(meta.certificate_hash,publisher,verifyEvent);
async function sign(e:Event) {
  await ownerCheck();
  validate(e);
  const {event}=await callCapabilityBroker('/api/mcp/capabilities/nostr-event',{event:{kind:e.kind,content:e.content,tags:e.tags}});
  if(!verifyEvent(event)||event.pubkey!==publisher||event.kind!==e.kind||event.content!==e.content||JSON.stringify(event.tags)!==JSON.stringify(e.tags))throw Error('Broker identity/template mismatch.');
  if(e.kind===30509 && event.created_at!==e.created_at)throw Error('Proof timestamp changed; regenerate proof.');
  return event;
}
async function exchange(message:unknown[], finish:(m:any[])=>boolean):Promise<any[]> {
  return new Promise((ok,fail)=>{
    const ws=new WebSocket(relay);const messages:any[]=[];
    const timeout=setTimeout(()=>{ws.close();fail(Error('Uncertain relay delivery; read back before retry.'))},20000);
    ws.onopen=()=>ws.send(JSON.stringify(message));
    ws.onerror=()=>{clearTimeout(timeout);ws.close();fail(Error('Relay connection failed; reconcile before retry.'));};
    ws.onmessage=({data})=>{const m=JSON.parse(String(data));messages.push(m);if(finish(m)){clearTimeout(timeout);ws.close();ok(messages);}};
  });
}
if((await readCapabilityIdentity()).botPubkeyHex!==publisher)throw Error('Rick broker identity required.');
if(action==='sign') {
  if(await Bun.file(run+'/signed.json').exists())throw Error('Existing signed set; reconcile rather than resign.');
  const events=(await Bun.file(run+'/unsigned.jsonl').text()).trim().split('\n').map(x=>JSON.parse(x)) as Event[];
  if(events.length!==3 || ![32267,3063,30063].every(k=>events.filter(e=>e.kind===k).length===1))throw Error('Expected exact zsp app, asset and release.');
  const asset=events.find(e=>e.kind===3063)!; const release=events.find(e=>e.kind===30063)!; const app=events.find(e=>e.kind===32267)!;
  asset.tags=asset.tags.map(t=>t[0]==='url'?['url',publicBase+'canopy-'+version+'.apk']:t);
  app.tags=app.tags.map(t=>t[0]==='icon'?['icon',publicBase+'icon.png']:t);
  const signedAsset=await sign(asset);
  release.tags=release.tags.map(t=>t[0]==='e'?['e',signedAsset.id,relay]:t);
  release.tags.push(['url',`https://cdn.zapstore.dev/${meta.hash}?redirect=true`]);
  await Bun.write(run+'/signed.json',JSON.stringify([await sign(app),signedAsset,await sign(release)],null,2));
} else if(action==='proof') {
  const e=await Bun.file(run+'/proof-unsigned.json').json(); const signed=await sign(e);
  const certificate=new X509Certificate(await Bun.file(run+'/certificate.der').arrayBuffer());
  if(createHash('sha256').update(certificate.raw).digest('hex')!==meta.certificate_hash || !verifyRSA('sha256',Buffer.from(`Verifying at ${signed.created_at} until ${tag(signed,'expiry')} that I control the following Nostr public key: ${publisher}`),certificate.publicKey,Buffer.from(tag(signed,'signature')!,'base64')))throw Error('Invalid RSA certificate proof.');
  await Bun.write(run+'/proof-signed.json',JSON.stringify(signed,null,2));
} else if(action==='publish'||action==='readback') {
  const events=[...await Bun.file(run+'/signed.json').json(),await Bun.file(run+'/proof-signed.json').json()];
  for(const e of events){validate(e);if(!verifyEvent(e))throw Error('Invalid signed event.');}
  if(action==='publish') {
    await ownerCheck();
    const {writeFile}=await import('node:fs/promises');
    await writeFile(run+'/publish-intent.json',JSON.stringify({ids:events.map(e=>e.id),createdAt:Date.now()}),{flag:'wx',mode:0o600});
    for(const e of events){await ownerCheck();const messages=await exchange(['EVENT',e],m=>m[0]==='OK'&&m[1]===e.id);await Bun.write(run+`/relay-${e.kind}.json`,JSON.stringify(messages));const response=messages.find(m=>m[0]==='OK');if(!response?.[2])throw Error('Relay rejected: '+response?.[3]);}
  }
  const messages=await exchange(['REQ','verify',{ids:events.map(e=>e.id)}],m=>m[0]==='EOSE'||m[0]==='CLOSED');
  await Bun.write(run+'/readback.json',JSON.stringify(messages,null,2));
  const found=messages.filter(m=>m[0]==='EVENT').map(m=>m[2]);
  console.log(JSON.stringify({expected:events.map(e=>e.id),found:found.filter(e=>verifyEvent(e)).map(e=>e.id)}));
  if(events.some(e=>!found.some(f=>f.id===e.id&&verifyEvent(f))))throw Error('Release not completely available in relay readback.');
} else throw Error('Use sign, proof, publish or readback.');
