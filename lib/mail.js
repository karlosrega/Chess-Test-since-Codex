import nodemailer from 'nodemailer';
import {readFileSync} from 'node:fs';

/** Credentials are read only from the process environment or a secret manager. */
export function createMailer(env=process.env,{production=true}={}){
  if(!env.SMTP_HOST)return null;
  env={...env};
  if(env.SMTP_PASSWORD_FILE)env.SMTP_PASSWORD=readFileSync(env.SMTP_PASSWORD_FILE,'utf8').trimEnd();
  const port=Number(env.SMTP_PORT||587),secure=env.SMTP_SECURE==='true';
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('SMTP_PORT inválido.');
  if(env.SMTP_SECURE!==undefined&&!['true','false'].includes(env.SMTP_SECURE))throw Error('SMTP_SECURE debe ser true o false.');
  if(typeof env.SMTP_FROM!=='string'||/[\r\n,;]/.test(env.SMTP_FROM)||! /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(env.SMTP_FROM))throw Error('SMTP_FROM requiere una dirección de correo válida.');
  if(production&&(!env.SMTP_USER||!env.SMTP_PASSWORD))throw Error('SMTP requiere usuario y contraseña en producción.');
  const local=['localhost','127.0.0.1','::1'].includes(env.SMTP_HOST);
  if(!production&&!local)throw Error('El transporte de pruebas sin TLS solo admite un servidor local.');
  const transport=nodemailer.createTransport({host:env.SMTP_HOST,port,secure,
    requireTLS:production&&!secure,ignoreTLS:!production,
    ...(env.SMTP_USER?{auth:{user:env.SMTP_USER,pass:env.SMTP_PASSWORD}}:{}),
    tls:{minVersion:'TLSv1.2',rejectUnauthorized:true,...(env.SMTP_TLS_SERVERNAME?{servername:env.SMTP_TLS_SERVERNAME}:{})},
    pool:true,maxConnections:2,maxMessages:100,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,dnsTimeout:10000,
    logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true,
  });
  let pending=0;
  return {verify:()=>transport.verify(),close:()=>transport.close(),send:async({to,subject,text})=>{
    if(pending>=100)throw Error('Cola de correo llena.');
    if(typeof to!=='string'||/[\r\n,;]/.test(to))throw Error('Destinatario inválido.');
    pending++;
    try{const result=await transport.sendMail({from:{name:'Jaque Royale',address:env.SMTP_FROM},to,subject,text});if(!result.accepted.length)throw Error('Correo rechazado.');}
    catch{throw Error('No se pudo entregar el correo de recuperación.');}
    finally{pending--;}
  }};
}
