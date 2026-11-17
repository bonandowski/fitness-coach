import { TYPES, TRAINING, SLOT_TARGETS, SLOT_LABELS } from './catalog.js';
import { toN, toS, weekday, loadOf } from './engine.js';

const T = (t) => TYPES[t] || TYPES.other;
const mondayOf = (n) => n - ((weekday(n) + 6) % 7);

export function computeStats(state, todayS, weeks = 8) {
  const today = toN(todayS);
  const done = state.entries.filter((e) => e.status === 'done').map((e) => ({ ...e, n: toN(e.date) }));
  const thisMon = mondayOf(today);

  const weekly = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = thisMon - 7 * w;
    const inW = done.filter((e) => e.n >= start && e.n < start + 7);
    const groups = {};
    for (const e of inW) if (TRAINING(e.type)) groups[T(e.type).group] = (groups[T(e.type).group] || 0) + 1;
    weekly.push({
      start: toS(start),
      groups,
      load: inW.reduce((a, e) => a + loadOf(e), 0),
      days: new Set(inW.filter((e) => TRAINING(e.type)).map((e) => e.n)).size,
      current: w === 0,
    });
  }

  // Settimana corrente: fatto + pianificato.
  const week = state.entries
    .filter((e) => e.status !== 'skipped')
    .map((e) => ({ ...e, n: toN(e.date) }))
    .filter((e) => e.n >= thisMon && e.n < thisMon + 7);
  const balance = Object.keys(SLOT_TARGETS).map((slot) => {
    const sum = (list) => list.reduce((a, e) => a + (T(e.type).slots[slot] || 0), 0);
    return {
      slot, label: SLOT_LABELS[slot], target: SLOT_TARGETS[slot],
      done: sum(week.filter((e) => e.status === 'done')),
      planned: sum(week.filter((e) => e.status === 'planned' && e.n >= today)),
    };
  });
  const calcetto = week.filter((e) => e.type === 'calcetto' && e.status === 'done').length;
  const elapsed = today - thisMon + 1;
  const trainedDays = new Set(week.filter((e) => e.status === 'done' && TRAINING(e.type) && e.n <= today).map((e) => e.n));
  const restDays = elapsed - trainedDays.size;

  // Carico acuto/cronico.
  const sumLoad = (from) => done.filter((e) => e.n > today - from && e.n <= today).reduce((a, e) => a + loadOf(e), 0);
  const acute = sumLoad(7);
  const chronic = sumLoad(28) / 4;
  const first = done.reduce((m, e) => Math.min(m, e.n), Infinity);
  const acwr = chronic >= 250 && first <= today - 21 ? acute / chronic : null;

  const last30 = done.filter((e) => e.n > today - 30 && e.n <= today && TRAINING(e.type));
  const slot30 = (slot) => last30.reduce((a, e) => a + (T(e.type).slots[slot] || 0), 0);
  const byType = {};
  for (const e of last30) byType[e.type] = (byType[e.type] || 0) + 1;

  return {
    weekly, balance, calcetto, restDays, acute, chronic, acwr,
    last30: {
      sessions: last30.length,
      minutes: last30.reduce((a, e) => a + (e.dur ?? T(e.type).dur), 0),
      days: new Set(last30.map((e) => e.n)).size,
      pull: slot30('pull'),
      push: slot30('push'),
      byType: Object.entries(byType).sort((a, b) => b[1] - a[1]),
    },
  };
}
