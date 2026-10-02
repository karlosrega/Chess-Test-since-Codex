import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const {chromium}=createRequire(new URL('../.qa-tools/package.json',import.meta.url))('playwright');
const base=process.env.QA_URL||'http://127.0.0.1:3001';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(base+'/#account');await page.locator('#loginTab').click();await page.locator('#email').fill('qa@example.com');await page.locator('#password').fill('Jaque QA 2026 seguro!');await page.locator('#accountSubmit').click();await page.locator('#homeView').waitFor({state:'visible'});
  await page.goto(base+'/#practice?id=e04');await page.locator('#practiceView .training-help:not([disabled])').waitFor();
  await page.evaluate(async()=>{const session=await(await fetch('/api/auth/session')).json();const run=await(await fetch('/api/training/start',{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({item:'e04'})})).json();await fetch('/api/training/run/'+run.id,{method:'POST',headers:{'Content-Type':'application/json','x-csrf-token':session.csrf},body:JSON.stringify({type:'hint',version:run.version})});});
  let release,held;const gate=new Promise(r=>release=r),arrived=new Promise(r=>held=r);
  await page.route('**/api/training/run/*',async route=>{if(route.request().method()!=='GET')return route.continue();const response=await route.fetch();held();await gate;await route.fulfill({response});});
  await page.locator('#practiceView .training-help').click();await arrived;
  const started=page.waitForResponse(response=>response.url().endsWith('/api/training/start')&&response.request().postDataJSON().item==='e10');
  await page.evaluate(()=>location.hash='practice?id=e10');await started;await page.locator('#practiceView .training-restart:not([disabled])').waitFor();
  release();await page.waitForTimeout(100);
  const retry=page.waitForRequest(request=>request.url().endsWith('/api/training/start'));await page.locator('#practiceView .training-restart').click();assert.equal((await retry).postDataJSON().item,'e10');assert.deepEqual(errors,[]);
  console.log('PASS entrenamiento: recuperación tardía no reemplaza el ejercicio actual.');
}finally{await browser.close();}
