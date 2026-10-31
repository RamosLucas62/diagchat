import { createCipheriv, createDecipheriv, randomBytes, createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';
export const opaqueToken = () => randomBytes(32).toString('base64url');
export const hash = (value:string) => createHash('sha256').update(value).digest('hex');
export function encrypt(value:string, key=config.encryption) {
 const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return [iv,cipher.getAuthTag(),data].map(x=>x.toString('base64url')).join('.');
}
export function decrypt(value:string,key=config.encryption) {
 const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));
 const decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv); decipher.setAuthTag(tag);
 return Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8');
}
export function equal(a:string,b:string) { const x=Buffer.from(a),y=Buffer.from(b); return x.length===y.length&&timingSafeEqual(x,y); }
export function verifySignature(body:Buffer,signature:string,secret:string) {
 return equal(signature,'sha256='+createHmac('sha256',secret).update(body).digest('hex'));
}
export function safePhoto(value:string) { return !value || /^https:\/\//i.test(value) || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value); }
