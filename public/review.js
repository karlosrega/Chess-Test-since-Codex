import {api} from './api.js';
import {Board,boardFromFen} from './board.js';

export function createReview({container,session,notify}){
  container.innerHTML='<p class="eyebrow">APRENDE DE CADA JUGADA</p><h1>Revisión de partida</h1><p id="reviewStatus" role="status"></p><progress id="analysisProgress" max="100" value="0" hidden></progress><button id="requestAnalysis" hidden>Analizar partida</button><div id="reviewLayout" class="game-layout" hidden><section><div id="reviewBoard" class="board" aria-label="Tablero de revisión"></div><div class="review-controls"><button id="reviewFirst" aria-label="Posición inicial">|←</button><button id="reviewPrevious" aria-label="Jugada anterior">←</button><span id="reviewPosition"></span><button id="reviewNext" aria-label="Jugada siguiente">→</button><button id="reviewLast" aria-label="Posición final">→|</button><button id="reviewFlip">Girar ↻</button></div></section><aside><section class="card"><h2>Precisión de Jaque Royale</h2><div class="precision-pair"><div><small>Blancas</small><strong id="whitePrecision"></strong></div><div><small>Negras</small><strong id="blackPrecision"></strong></div></div><p>Índice aproximado propio por pérdida de evaluación. No equivale a la precisión de otras plataformas.</p></section><section class="card"><h2 id="reviewMoveLabel">Posición inicial</h2><p id="reviewEvaluation"></p><meter id="evaluationMeter" min="-1000" max="1000" value="0" aria-label="Evaluación desde el lado de blancas"></meter><p id="reviewFeedback"></p><p id="reviewBest"></p><p id="reviewVariation"></p></section><section class="card"><h2>Jugadas</h2><div id="reviewMoves" class="review-moves"></div></section></aside></div>';
  const $=id=>container.querySelector('#'+id),board=new Board($('reviewBoard'),()=>{});
  let id=null,result=null,position=0,loading=false,generation=0,owner=null;
  function render(){
    if(!result)return;
    const move=result.moves[position-1],fen=move?.after||result.initialFen;
    board.set({board:boardFromFen(fen),legal:[],lastMove:move?[move.from,move.to]:[]});
    $('reviewPosition').textContent=`${position} / ${result.moves.length}`;
    $('reviewPrevious').disabled=$('reviewFirst').disabled=position===0;
    $('reviewNext').disabled=$('reviewLast').disabled=position===result.moves.length;
    const score=move?.afterEval||result.moves[0]?.beforeEval;
    $('reviewMoveLabel').textContent=move?`${Math.ceil(position/2)}${move.color==='b'?'…':'.'} ${move.san}`:'Posición inicial';
    $('reviewEvaluation').textContent=move?.san.endsWith('#')?'Jaque mate':score?score.type==='mate'?`Mate en ${Math.abs(score.value)} · ${score.value>=0?'blancas':'negras'}`:`Evaluación: ${score.value>=0?'+':''}${(score.value/100).toFixed(2)} · blancas`:'Sin jugadas para evaluar.';
    $('evaluationMeter').value=score?score.type==='mate'?(score.value>=0?1000:-1000):Math.max(-1000,Math.min(1000,score.value)):0;
    $('reviewFeedback').textContent=move?`${move.label==='correcta'?'Jugada correcta':move.label==='grave'?'Error grave':move.label==='error'?'Error':'Imprecisión'} · pérdida ${move.loss} centipeones${move.lostMate?' · se perdió un mate forzado':''}`:'Recorre la partida para ver oportunidades de mejora.';
    $('reviewBest').textContent=move?`Mejor jugada: ${move.bestMove.slice(0,2)} → ${move.bestMove.slice(2,4)}`:'';
    $('reviewVariation').textContent=move?.pv.length?'Línea del motor: '+move.pv.map(m=>m.slice(0,2)+'→'+m.slice(2)).join(' · '):'';
    container.querySelectorAll('[data-ply]').forEach(b=>{b.classList.toggle('active',Number(b.dataset.ply)===position);b.setAttribute('aria-pressed',String(Number(b.dataset.ply)===position));});
  }
  async function load(nextId){
    if(owner!==session().me?.id){owner=session().me?.id;result=null;generation++;$('reviewLayout').hidden=true;}
    if(!nextId||!/^[A-F0-9]{6}$/.test(nextId)){id=null;result=null;generation++;$('reviewLayout').hidden=true;$('requestAnalysis').hidden=true;$('analysisProgress').hidden=true;$('reviewStatus').textContent='Partida de revisión inválida.';notify('Partida de revisión inválida.');return;}
    if(nextId!==id){id=nextId;result=null;position=0;generation++;$('reviewLayout').hidden=true;}
    if(loading)return;
    const currentGeneration=generation;loading=true;
    try{
      if(!session().me)throw Error('Inicia sesión para revisar tus partidas.');
      if(session().humanGame)throw Error('Termina tu partida contra otra persona antes de abrir un análisis.');
      const state=await api('/api/analysis/'+id);if(currentGeneration!==generation||owner!==session().me?.id)return;
      const labels={none:'Esta partida aún no tiene análisis.',pending:'Tu partida está en la cola de análisis.',processing:'Stockfish está revisando tus jugadas…',done:'Revisión lista · Stockfish 19 · 200 000 nodos por posición.',failed:state.error};
      $('reviewStatus').textContent=labels[state.status];$('analysisProgress').hidden=!['pending','processing'].includes(state.status);$('analysisProgress').value=state.progress;
      $('requestAnalysis').hidden=!['none','failed'].includes(state.status);$('requestAnalysis').textContent=state.status==='failed'?'Reintentar análisis':'Analizar partida';
      if(state.status==='done'&&state.result){result=state.result;$('reviewLayout').hidden=false;$('whitePrecision').textContent=result.whitePrecision==null?'—':result.whitePrecision+'%';$('blackPrecision').textContent=result.blackPrecision==null?'—':result.blackPrecision+'%';$('reviewMoves').replaceChildren(...result.moves.map(m=>{const b=document.createElement('button');b.dataset.ply=m.ply;b.textContent=`${Math.ceil(m.ply/2)}${m.color==='b'?'…':'.'} ${m.san}`;b.className=m.label==='grave'?'loss':m.label==='correcta'?'':'draw';b.onclick=()=>{position=m.ply;render();};return b;}));render();}
    }catch(error){if(currentGeneration!==generation)return;$('reviewStatus').textContent=error.message;$('reviewLayout').hidden=true;$('requestAnalysis').hidden=true;$('analysisProgress').hidden=true;}
    finally{loading=false;}
  }
  $('requestAnalysis').onclick=async()=>{if(!id)return;$('requestAnalysis').disabled=true;try{await api('/api/analysis/'+id,{},session().csrf);await load(id);}catch(error){notify(error.message);}finally{$('requestAnalysis').disabled=false;}};
  $('reviewFirst').onclick=()=>{position=0;render();};$('reviewLast').onclick=()=>{position=result.moves.length;render();};$('reviewPrevious').onclick=()=>{position=Math.max(0,position-1);render();};$('reviewNext').onclick=()=>{position=Math.min(result.moves.length,position+1);render();};$('reviewFlip').onclick=()=>board.flip();
  setInterval(()=>{if(id&&!container.hidden&&!result)load(id);},2000);
  return {load,update:message=>{if(message.game===id&&!container.hidden)load(id);}};
}
