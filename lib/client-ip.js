import {isIP} from 'node:net';

const normalized=value=>String(value||'').replace(/^::ffff:/,'');
/** Trust one explicitly configured proxy address, never arbitrary browser headers. */
export function clientIP(req,trustedProxy=process.env.TRUST_PROXY_IP){
  const remote=normalized(req.socket.remoteAddress);
  if(trustedProxy&&remote===normalized(trustedProxy)){
    const forwarded=String(req.headers['x-forwarded-for']||'').trim();
    if(isIP(forwarded))return normalized(forwarded);
  }
  return remote;
}
