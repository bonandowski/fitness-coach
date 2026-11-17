import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, toN, toS, gapReq } from '../js/engine.js';

// 2026-11-17 è un martedì.
const TODAY = '2026-11-17';
const rel = (k) => toS(toN(TODAY) + k);
let id = 0;
const e = (k, type, extra = {}) => ({ id: `e${id++}`, date: rel(k), type, status: k < 0 ? 'done' : 'planned', ...extra });

const base = (entries, more = {}) => ({
  entries,
  checkins: {},
  flags: {},
  settings: { assumeCalcetto: false, ...more.settings },
  ...more,
});
const dayOf = (p, k) => p.days.find((d) => d.date === rel(k));
const sugg = (p, k) => dayOf(p, k).suggestion?.type;

// Una settimana tipo alle spalle, per avere bisogni realistici.
const week = [
  e(-8, 'legs_heavy'), e(-7, 'pull'), e(-6, 'hills_short'), e(-5, 'push'), e(-3, 'run_easy'),
];

test('calcetto ieri: oggi niente gambe, salite o allunghi', () => {
  const p = plan(base([...week, e(-1, 'calcetto')]), TODAY);
  const today = dayOf(p, 0);
  const blocked = today.blocked.map((b) => b.type);
  for (const t of ['legs_heavy', 'legs_light', 'hills_short', 'hills_long', 'run_strides', 'run_steady']) {
    assert.ok(blocked.includes(t), `${t} dovrebbe essere bloccato`);
  }
  assert.ok(['rest', 'run_easy', 'mobility', 'pull', 'push'].includes(sugg(p, 0)));
});

test('calcetto ieri: gambe pesanti non prima di +3', () => {
  const p = plan(base([...week, e(-1, 'calcetto')]), TODAY);
  assert.ok(dayOf(p, 1).blocked.some((b) => b.type === 'legs_heavy'));
  assert.ok(!dayOf(p, 1).blocked.some((b) => b.type === 'hills_short'), 'sprint brevi ok a +2');
});

test('calcetto blando (RPE 4): recupero più rapido', () => {
  const [hard] = gapReq({ type: 'calcetto', rpe: 4 }, 'legs_light');
  assert.equal(hard, 1);
});

test('giorno prima del calcetto: defaticante o riposo', () => {
  const p = plan(base([...week, e(3, 'calcetto')]), TODAY);
  assert.ok(['run_easy', 'rest'].includes(sugg(p, 2)), `trovato ${sugg(p, 2)}`);
  for (const t of ['legs_heavy', 'hills_short', 'pull', 'push']) {
    assert.ok(dayOf(p, 2).blocked.some((b) => b.type === t), `${t} bloccato il giorno prima`);
  }
});

test('niente gambe pesanti nelle 72h prima del calcetto', () => {
  const p = plan(base([...week, e(2, 'calcetto')]), TODAY);
  assert.ok(dayOf(p, 0).blocked.some((b) => b.type === 'legs_heavy'));
  assert.ok(!dayOf(p, 0).blocked.some((b) => b.type === 'hills_short'), 'sprint ok a 48h');
});

test('quadricipiti induriti: niente gambe, ok parte alta', () => {
  const p = plan(base(week, { checkins: { [TODAY]: { legs: 'hard' } } }), TODAY);
  assert.ok(!['legs_heavy', 'legs_light', 'hills_short', 'hills_long', 'run_strides', 'run_steady'].includes(sugg(p, 0)));
});

test('rigidità: scala di un livello (gambe pesanti -> gambe leggere)', () => {
  const hist = [e(-9, 'legs_heavy'), e(-5, 'pull'), e(-3, 'push'), e(-4, 'hills_short')];
  const normal = plan(base(hist), TODAY);
  assert.equal(sugg(normal, 0), 'legs_heavy');
  const stiff = plan(base(hist, { checkins: { [TODAY]: { stiff: true } } }), TODAY);
  assert.equal(sugg(stiff, 0), 'legs_light');
  assert.equal(dayOf(stiff, 0).suggestion.from, 'legs_heavy');
});

test('fastidio che tira: stop a gambe pesanti e salite', () => {
  const p = plan(base(week, { flags: { pain: true } }), TODAY);
  for (const d of p.days) {
    assert.ok(!['legs_heavy', 'hills_short', 'hills_long', 'run_strides'].includes(d.suggestion?.type));
  }
});

test('spinta mai due giorni di fila', () => {
  const p = plan(base([...week, e(-1, 'push')]), TODAY);
  assert.ok(dayOf(p, 0).blocked.some((b) => b.type === 'push'));
});

test('mai due sedute dure di gambe consecutive', () => {
  const [hard] = gapReq({ type: 'hills_short' }, 'legs_heavy');
  assert.ok(hard >= 2);
});

test('il piano futuro rispetta sempre le finestre minime', () => {
  const p = plan(base([...week, e(5, 'calcetto')]), TODAY);
  const seq = p.days.map((d) => d.suggestion?.type || 'fixed');
  for (let i = 0; i < seq.length - 1; i++) {
    const a = seq[i], b = seq[i + 1];
    if (a === 'legs_heavy') assert.ok(!['legs_heavy', 'hills_short', 'hills_long'].includes(b), seq.join(','));
    if (a === 'push') assert.notEqual(b, 'push', seq.join(','));
  }
  // Almeno un giorno di riposo nella settimana.
  assert.ok(seq.slice(0, 7).includes('rest'), seq.join(','));
});

test('in 7 giorni il piano copre gambe, tirata, spinta e corsa', () => {
  const p = plan(base(week), TODAY);
  const seq = p.days.slice(0, 7).map((d) => d.suggestion?.type);
  for (const t of ['legs_heavy', 'pull', 'push']) assert.ok(seq.includes(t), `${t} mancante: ${seq.join(',')}`);
  assert.ok(seq.some((t) => ['hills_short', 'hills_long', 'run_strides', 'run_steady'].includes(t)), seq.join(','));
});

test('probabile calcetto domenica condiziona venerdì e sabato', () => {
  const p = plan(base(week, { settings: { assumeCalcetto: true, calcettoDay: 0 } }), TODAY);
  const sunday = p.days.find((d) => new Date(d.date).getUTCDay() === 0);
  assert.ok(sunday.ghost);
  const sat = dayOf(p, toN(sunday.date) - toN(TODAY) - 1);
  assert.ok(['run_easy', 'rest'].includes(sat.suggestion.type));
});

test('piano utente in conflitto: avviso + alternativa', () => {
  const p = plan(base([...week, e(-1, 'calcetto'), e(0, 'legs_heavy', { id: 'x' })]), TODAY);
  const d = dayOf(p, 0);
  assert.ok(d.warnings.x?.length);
  assert.ok(d.alternative);
});

test('stampa una settimana di esempio', () => {
  const p = plan(base([...week, e(-1, 'calcetto')], { settings: { assumeCalcetto: true } }), TODAY);
  for (const d of p.days) {
    console.log(d.date, d.ghost ? 'calcetto?' : d.suggestion?.type, '|', d.suggestion?.reasons.join(' · ') ?? '');
  }
});

test('gambe pesanti e corsa vera mai in giorni consecutivi', () => {
  const RUN = ['run_steady', 'run_strides', 'hills_short', 'hills_long'];
  const histories = [
    week,
    [...week, e(-1, 'calcetto')],
    [e(-9, 'legs_heavy'), e(-5, 'pull'), e(-3, 'push'), e(-6, 'run_steady')],
    [e(-12, 'legs_heavy'), e(-4, 'pull'), e(-2, 'hike', { dur: 200 }), e(-3, 'hills_short')],
  ];
  for (const h of histories) {
    for (const assume of [true, false]) {
      const p = plan(base(h, { settings: { assumeCalcetto: assume } }), TODAY);
      const seq = p.days.map((d) => d.suggestion?.type);
      for (let i = 0; i < seq.length - 1; i++) {
        const pair = [seq[i], seq[i + 1]];
        const bad = pair.includes('legs_heavy') && pair.some((t) => RUN.includes(t));
        assert.ok(!bad, seq.join(','));
      }
    }
  }
});
