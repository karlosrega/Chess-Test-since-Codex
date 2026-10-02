import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
const {chromium}=createRequire(new URL('../.qa-tools/package.json',import.meta.url))('playwright');
const base=process.env.QA_URL||'http://127.0.0.1:3001',password='Jaque QA 2026 seguro!',results=[];
mkdirSync('artifacts',{recursive:true});
const browser=await chromium.launch({headless:true});
async function login(page,email){await page.goto(base+'/#account');await page.locator('#loginTab').click();await page.locator('#email').fill(email);await page.locator('#password').fill(password);await page.locator('#accountSubmit').click();await page.locator('#homeView').waitFor({state:'visible'});await page.locator('#connection').filter({hasText:'Conectado'}).waitFor();}
async function move(page,scope,from,to,touch){
  const source=page.locator(scope+' [aria-label^="'+from+' "]'),target=page.locator(scope+' [aria-label^="'+to+' "]');
  if(touch){await source.tap();await target.tap();}else{const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:8});await page.mouse.up();}
}
try{
  for(const mobile of [false,true]){
    const errors=[],contexts=[];const options={viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile};
    const a=await browser.newContext(options),b=await browser.newContext(options);contexts.push(a,b);const page=await a.newPage(),rival=await b.newPage();
    for(const p of [page,rival]){p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text());});}
    try{
      await page.goto(base+'/#account');await page.locator('#registerTab').click();await page.locator('#name').fill('Navegador '+(mobile?'movil':'desktop'));await page.locator('#email').fill('browser-'+mobile+'@example.com');await page.locator('#password').fill(password);await page.locator('#accountSubmit').click();await page.locator('#homeView').waitFor({state:'visible'});
      await page.locator('#logout').click();await page.locator('#profileName').filter({hasText:'Bienvenido'}).waitFor();await page.locator('#homeView').waitFor({state:'visible'});await login(page,'qa@example.com');await login(rival,'rival@example.com');
      await page.locator('#statsCards .stat').nth(7).waitFor();assert.equal(await page.locator('#statsCards .stat').count(),8);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/home-'+(mobile?'mobile':'desktop')+'.png',fullPage:true});
      await page.goto(base+'/#play');await page.locator('#friendMode').selectOption('blitz');await page.locator('#create').click();await page.locator('#room').filter({hasText:/[A-F0-9]{6}/}).waitFor();const code=(await page.locator('#room').innerText()).match(/[A-F0-9]{6}/)[0];
      await rival.goto(base+'/#play');await rival.locator('#code').fill(code);await rival.locator('#joinForm button').click();await page.locator('#draw').waitFor({state:'visible'});await rival.locator('#draw').waitFor({state:'visible'});
      await move(page,'#board','e2','e4',mobile);await rival.locator('#moves li').filter({hasText:'e4'}).waitFor();await move(rival,'#board','e7','e5',mobile);await page.locator('#moves li').filter({hasText:'e5'}).waitFor();
      await page.reload();await page.locator('#moves li').filter({hasText:'e5'}).waitFor();await page.goto(base+'/#puzzles');await page.locator('.training-summary').filter({hasText:'Termina tu partida'}).waitFor();
      await page.goto(base+'/#play');await page.locator('#draw').click();await rival.locator('#draw').filter({hasText:'Aceptar tablas'}).click();await page.locator('#draw').waitFor({state:'hidden'});
      await page.goto(base+'/#puzzles?id=p01');await page.locator('.training-turn').filter({hasText:'Tu turno'}).waitFor();await move(page,'.training-board','e1','e8',mobile);await page.locator('.training-turn').filter({hasText:'¡Reto completado!'}).waitFor();
      await page.goto(base+'/#practice?id=e10');await page.locator('.training-turn').filter({hasText:'Tu turno'}).waitFor();await move(page,'.training-board','a7','a8',mobile);await page.locator('.training-promotion').waitFor({state:'visible'});await page.locator('.training-promotion [data-promotion="q"]').click();await page.locator('.training-turn').filter({hasText:'¡Reto completado!'}).waitFor();
      await page.reload();await page.locator('.training-turn').filter({hasText:'¡Reto completado!'}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/practice-'+(mobile?'mobile':'desktop')+'.png',fullPage:true});
      await page.locator('#logout').click();await page.locator('#profileName').filter({hasText:'Bienvenido'}).waitFor();assert.deepEqual(errors,[]);results.push({viewport:options.viewport,touch:mobile,passed:true,consoleErrors:errors});
    }catch(error){await page.screenshot({path:'artifacts/failure-'+(mobile?'mobile':'desktop')+'.png',fullPage:true});console.error('Browser failure:',await page.locator('#authStatus').textContent(),await page.locator('#alert').textContent());throw error;}
    finally{for(const context of contexts)await context.close();}
  }
  console.log('PASS navegador: registro, login, dos jugadores, drag/touch, reconexión, bloqueo de ayudas, tablas, entrenamiento, promoción, persistencia y logout.');
}finally{writeFileSync('artifacts/browser-results.json',JSON.stringify(results,null,2));await browser.close();}
