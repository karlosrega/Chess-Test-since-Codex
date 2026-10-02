import {trainingProgress} from './training.js';

export function historyFor(db, id, page = 1) {
  const filter = '(g.white=? OR g.black=?) AND g.status=\'finished\'';
  const total = db.prepare(`SELECT count(*) n FROM games g WHERE ${filter}`).get(id,id).n;
  const rows = db.prepare(`SELECT g.id,g.kind,g.mode,g.rated,g.bot_level,g.result,g.reason,g.finished,g.pgn,w.name white,b.name black,g.white whiteId,g.black blackId,r.before,r.after,a.status analysisStatus
    FROM games g JOIN users w ON w.id=g.white LEFT JOIN users b ON b.id=g.black
    LEFT JOIN ratings r ON r.game=g.id AND r.user=?
    LEFT JOIN analyses a ON a.game=g.id
    WHERE ${filter} ORDER BY g.finished DESC,g.id DESC LIMIT 20 OFFSET ?`).all(id,id,id,(page-1)*20);
  return { rows, total, page, pages: Math.ceil(total/20) };
}
export function statisticsFor(db, id) {
  const counts = db.prepare(`SELECT count(*) played,
    coalesce(sum(CASE WHEN (white=? AND result='1-0') OR (black=? AND result='0-1') THEN 1 ELSE 0 END),0) wins,
    coalesce(sum(CASE WHEN result='1/2-1/2' THEN 1 ELSE 0 END),0) draws
    FROM games WHERE (white=? OR black=?) AND status='finished' AND kind!='bot'`).get(id,id,id,id);
  const history = historyFor(db,id);
  const curve = db.prepare(`SELECT g.finished date,g.mode,r.before,r.after FROM ratings r JOIN games g ON g.id=r.game WHERE r.user=? ORDER BY g.finished,g.id`).all(id);
  const ratings = ['bullet','blitz','rapid'].map(mode => ({ mode, rating:1200, played:0, ...db.prepare('SELECT rating,played FROM mode_ratings WHERE user=? AND mode=?').get(id,mode) }));
  const analysis=db.prepare(`SELECT count(*) analyzed,avg(CASE WHEN g.white=? THEN json_extract(a.result,'$.whitePrecision') ELSE json_extract(a.result,'$.blackPrecision') END) precision FROM analyses a JOIN games g ON g.id=a.game WHERE a.status='done' AND (g.white=? OR g.black=?)`).get(id,id,id);
  const botGames=db.prepare("SELECT count(*) n FROM games WHERE status='finished' AND kind='bot' AND (white=? OR black=?)").get(id,id).n;
  return { ...counts, losses:counts.played-counts.wins-counts.draws, winRate:counts.played ? Math.round(100*counts.wins/counts.played) : 0, ratings, curve, history,analysis,botGames,training:trainingProgress(db,id) };
}
