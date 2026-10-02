const symbols={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}};
const names={k:'rey',q:'dama',r:'torre',b:'alfil',n:'caballo',p:'peón'};
export function boardFromFen(fen){return fen.split(' ')[0].split('/').map(row=>{const cells=[];for(const ch of row){if(/[1-8]/.test(ch))for(let i=0;i<Number(ch);i++)cells.push(null);else cells.push({type:ch.toLowerCase(),color:ch===ch.toUpperCase()?'w':'b'});}return cells;});}
export function initialBoard(){const order=['r','n','b','q','k','b','n','r'];return Array.from({length:8},(_,r)=>Array.from({length:8},(_,c)=>r===0||r===7?{type:order[c],color:r===0?'b':'w'}:r===1||r===6?{type:'p',color:r===1?'b':'w'}:null));}
export class Board {
  constructor(element,onSquare){
    this.element=element;this.onSquare=onSquare;this.black=false;this.focusSquare='a8';this.data={board:initialBoard(),legal:[]};
    element.setAttribute('aria-description','Usa las flechas para recorrer las casillas y Enter o Espacio para seleccionar.');
    element.addEventListener('focusin',e=>{const square=e.target.closest('[data-square]');if(!square)return;this.focusSquare=square.dataset.square;for(const button of element.children)button.tabIndex=button===square?0:-1;});
    element.addEventListener('click',e=>{if(this.suppressClick){this.suppressClick=false;return;}const b=e.target.closest('[data-square]');if(b)this.onSquare(b.dataset.square);});
    element.addEventListener('pointerdown',e=>{const b=e.target.closest('[data-square]');if(b&&e.button===0)this.drag={square:b.dataset.square,x:e.clientX,y:e.clientY};});
    document.addEventListener('pointerup',e=>{if(!this.drag)return;const start=this.drag;this.drag=null;const end=document.elementFromPoint(e.clientX,e.clientY)?.closest('[data-square]');if(end&&element.contains(end)&&end.dataset.square!==start.square&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>8){this.suppressClick=true;this.onSquare(start.square);this.onSquare(end.dataset.square);setTimeout(()=>{this.suppressClick=false;},0);}});
    element.addEventListener('pointercancel',()=>{this.drag=null;});
    element.addEventListener('keydown',e=>{const offsets={ArrowLeft:-1,ArrowRight:1,ArrowUp:-8,ArrowDown:8};if(!(e.key in offsets))return;const buttons=[...element.children],index=buttons.indexOf(e.target);if(index<0)return;e.preventDefault();if((e.key==='ArrowLeft'&&index%8===0)||(e.key==='ArrowRight'&&index%8===7))return;buttons[Math.max(0,Math.min(63,index+offsets[e.key]))].focus();});
    this.render();
  }
  set(data,selected=null){this.data=data;this.selected=selected;this.render();}
  flip(){this.black=!this.black;this.render();}
  render(){
    const focused=document.activeElement?.dataset.square,fragment=document.createDocumentFragment();
    for(let i=0;i<8;i++)for(let j=0;j<8;j++){
      const r=this.black?7-i:i,c=this.black?7-j:j,square=String.fromCharCode(97+c)+(8-r),piece=this.data.board[r][c],b=document.createElement('button');
      b.type='button';b.dataset.square=square;b.tabIndex=square===this.focusSquare?0:-1;b.className='square'+((r+c)%2?' dark':'')+(piece?.color==='w'?' white-piece':'')+(this.selected===square?' selected':'');
      if((this.data.legal||[]).some(m=>m.from===this.selected&&m.to===square))b.classList.add(piece?'capture':'legal');
      if(this.data.lastMove?.includes(square))b.classList.add('last');
      if(this.data.check&&piece?.type==='k'&&piece.color===this.data.turn)b.classList.add('in-check');
      b.textContent=piece?symbols[piece.color][piece.type]:'';b.setAttribute('aria-label',`${square}${piece?' '+names[piece.type]+' '+(piece.color==='w'?'blanco':'negro'):' vacía'}`);b.setAttribute('aria-pressed',String(this.selected===square));
      if(j===0||i===7){const label=document.createElement('span');label.className='coord';label.textContent=(j===0?8-r:'')+(i===7?String.fromCharCode(97+c):'');label.setAttribute('aria-hidden','true');b.append(label);}fragment.append(b);
    }
    this.element.replaceChildren(fragment);if(focused)this.element.querySelector(`[data-square="${focused}"]`)?.focus({preventScroll:true});
  }
}
