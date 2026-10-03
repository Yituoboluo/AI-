import {createHash} from 'node:crypto';
import {put, get, head, del, BlobNotFoundError} from '@vercel/blob';

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
export const IMAGE_TYPES = Object.freeze({'image/png':'png','image/jpeg':'jpeg','image/webp':'webp'});
const ASSET_KEY = /^[a-f0-9]{64}\/assets\/([a-f0-9]{64})\.(png|jpeg|webp)$/;
export const defaultBlobSdk = Object.freeze({put,get,head,del});
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const ownerPrefix = owner => sha256(String(owner));

export function imageBytes(value, contentType, expectedHash, expectedSize) {
  if (!Object.hasOwn(IMAGE_TYPES,contentType)) throw new Error('Invalid image type');
  const bytes = value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES || (expectedSize !== undefined && bytes.byteLength !== expectedSize)) throw new Error('Invalid image size');
  const magic = contentType==='image/png'
    ? [137,80,78,71,13,10,26,10].every((byte,index)=>bytes[index]===byte)
    : contentType==='image/jpeg'
      ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255
      : bytes[0]===82 && bytes[1]===73 && bytes[2]===70 && bytes[3]===70 && bytes[8]===87 && bytes[9]===69 && bytes[10]===66 && bytes[11]===80;
  if (!magic || (expectedHash !== undefined && sha256(bytes)!==expectedHash)) throw new Error('Invalid image content');
  return bytes;
}

function assertKey(key) {
  if (typeof key!=='string' || !ASSET_KEY.test(key)) throw new Error('Invalid asset key');
  return key.match(ASSET_KEY);
}

export function blobToken(env) {
  const token=env.BLOB_READ_WRITE_TOKEN;
  if (typeof token!=='string' || !/^vercel_blob_rw_[a-zA-Z0-9]+_[a-zA-Z0-9_-]+$/.test(token)) throw new Error('Blob storage unavailable');
  return token;
}

export async function privateGet(sdk, env, pathname) {
  try { return await sdk.get(pathname,{token:blobToken(env),access:'private',useCache:false}); }
  catch(error) { if(error instanceof BlobNotFoundError)return null;throw error; }
}

export function createBlobBucket(env, sdkOverrides={}) {
  const sdk={...defaultBlobSdk,...sdkOverrides};
  const options=()=>({token:blobToken(env)});
  async function existing(key) {
    try { return await sdk.head(key,options()) ? {} : null; }
    catch(error) { if(error instanceof BlobNotFoundError)return null;throw error; }
  }
  return {
    async put(key,value,{httpMetadata}={}) {
      const [,expectedHash,extension]=assertKey(key),contentType='image/'+extension;
      if(httpMetadata?.contentType!==contentType)throw new Error('Invalid image type');
      const bytes=imageBytes(value,contentType,expectedHash);
      if(await existing(key))return {};
      try {
        await sdk.put(key,bytes,{...options(),access:'private',contentType,addRandomSuffix:false,allowOverwrite:false});
      } catch(error) {
        // Another invocation may have promoted the same verified content concurrently.
        // The immutable name is its SHA-256, so an existing destination is equivalent.
        if(!await existing(key))throw error;
      }
      return {};
    },
    async get(key) {
      assertKey(key);
      const object=await privateGet(sdk,env,key);
      if(!object)return null;
      if(object.statusCode!==200 || !object.stream || object.blob?.pathname!==key)throw new Error('Invalid Blob response');
      return {body:object.stream,httpMetadata:{contentType:object.blob.contentType}};
    },
    async head(key) {assertKey(key);return existing(key);},
  };
}
