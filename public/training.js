import {api} from './api.js';
import {Board} from './board.js';

const levels={easy:'Fácil',medium:'Medio',hard:'Difícil'};
const motifs={mate:'Mates',horquilla:'Horquillas',clavada:'Clavadas',descubierto:'Ataques descubiertos',final:'Finales'};
function node(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}

export function createTrainingView({container,kind,session,onProgress,notify}){
  const title=kind==='puzzle'?'Una mirada. La jugada.':'Aprende haciendo.';
  container.innerHTML=`<p class="eyebrow">${kind==='puzzle'?'ENCUENTRA LA JUGADA':'APRENDE EN EL TABLERO'}</p><h1>${title}</h1><p>${kind==='puzzle'?'30 posiciones originales para entrenar tu visión táctica.':'12 ejercicios guiados de mates y finales. Explora, deshaz y vuelve a intentarlo.'}</p><div class="training-summary" role="status"></div><div class="training-filters"><label>Dificultad<select class="training-level"><option value="all">Todas</option><option value="easy">Fácil</option><option value="medium">Medio</option><option value="hard">Difícil</option></select></label><label>Tema<select class="training-motif"><option value="all">Todos</option></select></label><label>Progreso<select class="training-filter"><option value="all">Todos</option><option value="pending">Por resolver</option><option value="solved">Resueltos</option></select></label></div><div class="training-list"></div><div class="training-play game-layout" hidden><section><div class="training-board board" aria-label="Tablero de entrenamiento"></div><div class="review-controls"><button class="training-flip">Girar ↻</button><button class="training-undo" hidden>Deshacer</button><button class="training-explore" hidden>Explorar</button><button class="training-guide" hidden>Volver a la guía</button></div></section><aside><section class="card"><p class="eyebrow training-label"></p><h2 class="training-title"></h2><p class="training-objective"></p><p class="training-turn"></p><p class="training-feedback" role="status" aria-live="polite"></p><p class="training-hint"></p><p class="training-explanation"></p><div class="training-actions"><button class="training-help">Pedir pista</button><button class="training-reveal">Ver solución</button><button class="training-restart">Reintentar</button><button class="training-next primary">Siguiente reto →</button><button class="training-back">Volver al catálogo</button></div><p class="training-record"></p></section><section class="card"><h2>Tu secuencia</h2><ol class="training-moves"></ol></section></aside></div><dialog class="training-promotion"><h2>Elige tu promoción</h2><div class="promotion-choices"><button data-promotion="q">♕ Dama</button><button data-promotion="r">♖ Torre</button><button data-promotion="b">♗ Alfil</button><button data-promotion="n">♘ Caballo</button></div><button class="training-promotion-cancel">Cancelar</button></dialog>`;
  const $=selector=>container.querySelector(selector);
  let items=[],run=null,selected=null,busy=false,generation=0,promotion=null;
  const board=new Board($('.training-board'),square=>{
    if(busy||!run||run.status!=='active')return;
    const moves=run.legal.filter(m=>m.from===selected&&m.to===square);
    if(moves.length){const from=selected;selected=null;if(moves.some(m=>m.promotion)){promotion={from,to:square};$('.training-promotion').showModal();}else act('move',{move:from+square});}
    else{const piece=run.board[8-Number(square[1])][square.charCodeAt(0)-97];selected=piece?.color===run.turn?square:null;board.set(run,selected);}
  });
  function routeTo(id){location.hash=(kind==='puzzle'?'puzzles':'practice')+(id?'?id='+id:'');}
  function catalog(){
    const filtered=items.filter(item=>($('.training-level').value==='all'||item.difficulty===$('.training-level').value)&&($('.training-motif').value==='all'||item.motif===$('.training-motif').value)&&($('.training-filter').value==='all'||Boolean(item.progress.solved)===($('.training-filter').value==='solved')));
    $('.training-list').replaceChildren(...filtered.map(item=>{
      const button=node('button',undefined,'training-card');button.type='button';button.append(node('small',levels[item.difficulty]+' · '+motifs[item.motif]),node('strong',item.title),node('span',item.progress.solved?(item.progress.unassisted?'✓ Resuelto por tu cuenta':'✓ Resuelto con ayuda'):item.progress.active?'Continuar tu intento →':'Resolver →'));button.onclick=()=>routeTo(item.id);return button;
    }));
    if(!filtered.length)$('.training-list').append(node('p','No hay retos con estos filtros.','empty-copy'));
  }
  function render(){
    if(!run)return;
    $('.training-list').hidden=true;$('.training-filters').hidden=true;$('.training-play').hidden=false;
    $('.training-title').textContent=run.item.title;$('.training-label').textContent=levels[run.item.difficulty]+' · '+motifs[run.item.motif];$('.training-objective').textContent=run.item.objective;
    $('.training-turn').textContent=run.status==='active'?(run.mode==='explore'?'Exploración libre · ':'Tu turno · ')+(run.turn==='w'?'Blancas':'Negras')+(run.check?' · Jaque':''):run.status==='solved'?'¡Reto completado!':'Solución mostrada';
    $('.training-feedback').textContent=run.feedback||'';$('.training-hint').textContent=run.hint||'';$('.training-explanation').textContent=run.explanation||'';
    $('.training-record').textContent=`${run.errors} intentos de jugada fallidos · ${run.hints} pistas${run.assisted?' · Con ayuda':''}`;
    $('.training-help').hidden=run.status!=='active'||run.mode==='explore';$('.training-reveal').hidden=run.status!=='active';$('.training-next').hidden=run.status==='active';
    $('.training-undo').hidden=kind!=='exercise';$('.training-undo').disabled=!run.canUndo;
    $('.training-explore').hidden=kind!=='exercise'||run.status!=='active'||run.mode==='explore';$('.training-guide').hidden=run.mode!=='explore'||run.status!=='active';
    $('.training-moves').replaceChildren(...run.moves.map(move=>node('li',move)));board.set(run,selected);
  }
  function lock(value){busy=value;container.querySelectorAll('.training-actions button,.review-controls button').forEach(button=>button.disabled=value);if(!value&&run)$('.training-undo').disabled=!run.canUndo;}
  async function start(id,restart=false){
    if(!session().me){notify('Inicia sesión para guardar tu progreso.');location.hash='account';return;}
    const current=++generation;lock(true);
    try{const result=await api('/api/training/start',{item:id,restart},session().csrf);if(current!==generation)return;run=result;selected=null;board.black=run.item.color==='b';render();}
    catch(error){if(current!==generation)return;notify(error.message);$('.training-play').hidden=true;$('.training-list').hidden=false;$('.training-filters').hidden=false;}
    finally{if(current===generation)lock(false);}
  }
  async function act(type,extra={}){
    if(busy||!run)return;const current=generation;lock(true);notify('');
    try{const result=await api('/api/training/run/'+run.id,{type,version:run.version,...extra},session().csrf);if(current!==generation)return;run=result;selected=null;render();if(type==='hint'||run.status!=='active'){
      await onProgress();if(current!==generation)return;const latest=await api('/api/training/catalog?kind='+kind);if(current!==generation)return;items=latest.items;const progress=latest.progress[kind==='puzzle'?'puzzles':'exercises'];$('.training-summary').textContent=`${progress.solved} / ${progress.total} resueltos · ${progress.unassisted} sin ayuda`;
    }}
    catch(error){if(current!==generation)return;notify(error.message);try{const recovered=await api('/api/training/run/'+run.id);if(current!==generation)return;run=recovered;render();}catch{if(current===generation){run=null;$('.training-play').hidden=true;}}}
    finally{if(current===generation)lock(false);}
  }
  $('.training-level').onchange=$('.training-motif').onchange=$('.training-filter').onchange=catalog;
  $('.training-flip').onclick=()=>board.flip();$('.training-help').onclick=()=>act('hint');$('.training-reveal').onclick=()=>act('reveal');$('.training-undo').onclick=()=>act('undo');$('.training-explore').onclick=()=>act('explore');$('.training-guide').onclick=()=>act('guide');$('.training-restart').onclick=()=>start(run.item.id,true);$('.training-back').onclick=()=>routeTo();
  $('.training-next').onclick=()=>{const index=items.findIndex(item=>item.id===run.item.id);routeTo(items[(index+1)%items.length].id);};
  container.querySelectorAll('[data-promotion]').forEach(button=>button.onclick=()=>{const move=promotion;promotion=null;$('.training-promotion').close();if(move)act('move',{move:move.from+move.to+button.dataset.promotion});});$('.training-promotion-cancel').onclick=()=>{promotion=null;$('.training-promotion').close();};
  return {clear(){generation++;run=null;items=[];selected=null;promotion=null;lock(false);$('.training-promotion').close();$('.training-play').hidden=true;$('.training-list').replaceChildren();$('.training-summary').textContent='Inicia sesión para ver tu progreso.';},async load(id){
    const current=++generation;run=null;selected=null;$('.training-promotion').close();$('.training-play').hidden=true;$('.training-list').hidden=false;$('.training-filters').hidden=false;$('.training-summary').textContent='Cargando retos…';
    if(!session().me){$('.training-summary').textContent='Inicia sesión para ver tu progreso.';$('.training-list').replaceChildren();$('.training-filters').hidden=true;return;}
    if(session().humanGame){$('.training-summary').textContent='Termina tu partida contra otra persona antes de entrenar.';$('.training-list').replaceChildren();$('.training-filters').hidden=true;return;}
    try{const result=await api('/api/training/catalog?kind='+kind);if(current!==generation)return;items=result.items;const progress=result.progress[kind==='puzzle'?'puzzles':'exercises'];$('.training-summary').textContent=`${progress.solved} / ${progress.total} resueltos · ${progress.unassisted} sin ayuda`;
      const select=$('.training-motif'),previous=select.value;select.replaceChildren(new Option('Todos','all'),...Array.from(new Set(items.map(item=>item.motif))).map(motif=>new Option(motifs[motif],motif)));if([...select.options].some(option=>option.value===previous))select.value=previous;
      catalog();if(id){if(!items.some(item=>item.id===id))throw Error('Reto no encontrado.');await start(id);}
    }catch(error){if(current!==generation)return;$('.training-summary').textContent=error.message;$('.training-list').replaceChildren();notify(error.message);}
  }};
}
