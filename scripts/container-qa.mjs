import {createApp} from '../server.js';

// Disposable CI fixture: production application checks, synthetic mail transport.
// This is never the deployment entry point and never sends external email.
const app=createApp({production:true,publicUrl:'https://qa.invalid',sendMail:async()=>{}});
await app.prepare();
app.server.listen(3000,'0.0.0.0',()=>console.log('CI fixture ready'));
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{await app.close();process.exit(0);});
