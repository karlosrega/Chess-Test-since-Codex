import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDatabase} from '../lib/database.js';
import {statisticsFor,historyFor} from '../lib/statistics.js';
test('estadísticas: resultados relativos, orden, paginación y categorías independientes',()=>{
  const db=openDatabase(':memory:');
  try {
    db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run('a','Ana');
    db.prepare('INSERT INTO users(id,name) VALUES(?,?)').run('b','Beto');
    for(let i=0;i<23;i++)db.prepare("INSERT INTO games(id,white,black,status,result,finished,reason) VALUES(?,?,?,'finished',?,?,?)").run(String(i).padStart(2,'0'),'a','b',i<10?'1-0':i<13?'1/2-1/2':'0-1',`2026-10-${String(i+1).padStart(2,'0')} 12:00:00`,'Prueba');
    const a=statisticsFor(db,'a'),b=statisticsFor(db,'b');
    assert.equal(a.played,23);assert.equal(a.wins,10);assert.equal(a.draws,3);assert.equal(a.losses,10);assert.equal(a.winRate,43);
    assert.equal(b.wins,10);assert.equal(a.history.rows.length,20);assert.equal(a.history.rows[0].id,'22');
    assert.equal(historyFor(db,'a',2).rows.length,3);assert.equal(historyFor(db,'a',2).pages,2);
    assert.deepEqual(a.ratings.map(r=>r.rating),[1200,1200,1200]);
    assert.equal(a.history.rows[0].before,null);
  }finally{db.close();}
});
