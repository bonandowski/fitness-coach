// Catalogo attività e regole di recupero (dati puri, nessuna logica).
// Ogni regola è commentata con l'euristica da cui deriva: vedi docs/EURISTICHE.md.

// group: usato per statistiche e colori.
// hard: seduta impegnativa a livello sistemico (alternanza duro/facile).
// hardLegs: seduta dura per le gambe (mai due di fila).
// suggest: l'algoritmo può proporla. Le altre le registri tu e lui ne tiene conto.
// slots: quanto la seduta "copre" ciascun obiettivo settimanale.
export const TYPES = {
  legs_heavy: {
    label: 'Gambe pesanti', group: 'legs', hard: true, hardLegs: true, suggest: true,
    dur: 60, rpe: 8, slots: { legs: 1 },
    guide: "60' palestra gambe: unilaterali pesanti (affondi, bulgarian, step-up), goblet, hip thrust, polpacci. Espira in spinta, niente apnea.",
  },
  legs_light: {
    label: 'Gambe leggere', group: 'legs', hard: false, suggest: true,
    dur: 40, rpe: 5, slots: { legs: 0.5 },
    guide: "40' gambe leggere: unilaterali a carico moderato, glutei, polpacci, pliometria bassa. Lontano dal cedimento.",
  },
  pull: {
    label: 'Tirata / schiena', group: 'pull', hard: false, suggest: true,
    dur: 60, rpe: 7, slots: { pull: 1 },
    guide: "60' tirata: trazioni, rematore, face pull, deltoide posteriore, bicipiti. Priorità postura: scapole basse e indietro.",
  },
  push: {
    label: 'Spinta', group: 'push', hard: false, suggest: true,
    dur: 60, rpe: 7, slots: { push: 1 },
    guide: "60' spinta: panca manubri, military manubri seduto, dip, tricipiti. Espira in spinta, niente massimali a fiato trattenuto.",
  },
  hills_short: {
    label: 'Sprint in salita', group: 'run', hard: true, hardLegs: true, suggest: true,
    dur: 35, rpe: 8, slots: { run: 1, quality: 1 },
    guide: "15' riscaldamento + 8-10 sprint in salita da 10-15\", recupero camminando in discesa.",
  },
  hills_long: {
    label: 'Ripetute in salita', group: 'run', hard: true, hardLegs: true, suggest: true,
    dur: 40, rpe: 8, slots: { run: 1, quality: 1 },
    guide: "15' riscaldamento + 6-8 ripetute in salita da 30-40\", recupero in discesa lenta.",
  },
  run_strides: {
    label: 'Corsa + allunghi', group: 'run', hard: false, suggest: true,
    dur: 30, rpe: 6, slots: { run: 1, quality: 0.6 },
    guide: "20-25' facile + 6-8 allunghi da 80-100 m in progressione, recupero completo.",
  },
  run_steady: {
    label: 'Corsa costante', group: 'run', hard: false, suggest: true,
    dur: 35, rpe: 6, slots: { run: 1 },
    guide: "30-40' a ritmo costante intorno a 5:10/km.",
  },
  run_easy: {
    label: 'Defaticante', group: 'run', hard: false, suggest: true,
    dur: 20, rpe: 3, slots: { run: 0.5 },
    guide: "20' di corsa facile a 5:45-6:15/km, deve sembrarti troppo lenta.",
  },
  mobility: {
    label: 'Mobilità / postura', group: 'recovery', hard: false, suggest: true,
    dur: 20, rpe: 2, slots: {},
    guide: "15-20' mobilità di anche, toracica e caviglie + posturali (wall slide, bird dog, band pull-apart).",
  },
  rest: {
    label: 'Riposo', group: 'rest', hard: false, suggest: true,
    dur: 0, rpe: 0, slots: {},
    guide: 'Riposo completo. Una camminata tranquilla va benissimo.',
  },
  // Registrate dall'utente, non proposte.
  calcetto: {
    label: 'Calcetto', group: 'calcetto', hard: true, hardLegs: true, suggest: false,
    dur: 60, rpe: 8, slots: { run: 0.5 },
    guide: 'Partita. RPE 4 o meno = blando: recuperi più in fretta.',
  },
  calisthenics: {
    label: 'Calisthenics', group: 'other', hard: false, suggest: false,
    dur: 45, rpe: 7, slots: { pull: 0.7, push: 0.7 },
    guide: 'Parchetto: trazioni, dip, push-up. Conta come mezza tirata e mezza spinta.',
  },
  beach: {
    label: 'Beach volley', group: 'other', hard: true, hardLegs: true, suggest: false,
    dur: 90, rpe: 7, slots: {},
    guide: 'Salti e cambi di direzione sulla sabbia: carico su polpacci e tendini.',
  },
  hike: {
    label: 'Montagna', group: 'other', hard: true, suggest: false,
    dur: 180, rpe: 6, slots: {},
    guide: 'Camminata in montagna: la discesa carica molto i quadricipiti. Oltre 2h30 conta come seduta dura per le gambe.',
  },
  other: {
    label: 'Altro', group: 'other', hard: false, suggest: false,
    dur: 45, rpe: 5, slots: {},
    guide: 'Qualsiasi altra attività.',
  },
};

export const SUGGESTABLE = Object.keys(TYPES).filter((k) => TYPES[k].suggest);
export const TRAINING = (type) => type !== 'rest' && type !== 'mobility';

// Finestre minime tra la seduta A (riga) e la seduta B (colonna), in giorni.
// [hard, ideal]: sotto hard è vietato, tra hard e ideal è sconsigliato (penalità).
// Valgono in entrambe le direzioni del tempo: "dopo A aspetta N giorni per B"
// equivale a "prima di B non fare A negli N giorni precedenti".
const LEG_RUN = ['legs_heavy', 'legs_light', 'hills_short', 'hills_long', 'run_strides', 'run_steady'];
export const GAPS = {
  // Gambe pesanti: 48-72h prima di rifare gambe o sprint.
  legs_heavy: {
    legs_heavy: [2, 3], legs_light: [2, 2], hills_short: [2, 2], hills_long: [2, 3],
    run_strides: [1, 2], run_steady: [1, 1], run_easy: [0, 1],
    // Niente gambe pesanti nelle 48h prima del calcetto; meglio 3 giorni.
    calcetto: [3, 3], beach: [2, 2],
  },
  legs_light: {
    legs_heavy: [1, 2], legs_light: [1, 2], hills_short: [1, 1], hills_long: [1, 2],
    run_strides: [0, 1], run_steady: [0, 1], calcetto: [2, 2], beach: [1, 2],
  },
  // Sprint in salita 10-15": 36-48h. Mai il giorno prima del calcetto.
  hills_short: {
    hills_short: [2, 2], hills_long: [2, 2], legs_heavy: [1, 2], legs_light: [1, 1],
    run_strides: [1, 1], run_steady: [1, 1], calcetto: [2, 2], beach: [2, 2],
  },
  // Salite lunghe 30-40": 48-72h.
  hills_long: {
    hills_short: [2, 3], hills_long: [2, 3], legs_heavy: [2, 2], legs_light: [1, 2],
    run_strides: [1, 2], run_steady: [1, 1], calcetto: [2, 3], beach: [2, 2],
  },
  run_strides: {
    hills_short: [1, 1], hills_long: [1, 1], legs_heavy: [1, 1], run_strides: [1, 2],
    // Il giorno prima del calcetto solo defaticante.
    calcetto: [2, 2],
  },
  run_steady: {
    legs_heavy: [1, 1], hills_short: [1, 1], hills_long: [1, 1], run_steady: [0, 1],
    calcetto: [2, 2],
  },
  // Corsa facile / mobilità: 12-24h, nessun vincolo reale.
  run_easy: {},
  mobility: {},
  rest: {},
  // Parte alta: 48h per lo stesso gruppo, spinta e tirata si alternano.
  push: { push: [2, 2], beach: [1, 1] },
  pull: { pull: [2, 2], calisthenics: [1, 2] },
  calisthenics: { pull: [2, 2], push: [1, 2], calisthenics: [1, 2] },
  // Calcetto: 48h per le gambe. Il giorno dopo solo defaticante, mobilità o parte alta.
  calcetto: {
    legs_heavy: [3, 3], legs_light: [2, 2], hills_short: [2, 2], hills_long: [3, 3],
    run_strides: [2, 2], run_steady: [2, 2], run_easy: [1, 1],
    push: [1, 1], pull: [1, 1], calcetto: [2, 2],
  },
  beach: {
    legs_heavy: [2, 2], legs_light: [1, 1], hills_short: [2, 2], hills_long: [2, 2],
    run_strides: [1, 2], run_steady: [1, 1], push: [1, 1], calcetto: [1, 2],
  },
  // Montagna: la discesa è eccentrica sui quadricipiti.
  hike: {
    legs_heavy: [2, 3], legs_light: [1, 2], hills_short: [1, 2], hills_long: [2, 2],
    run_strides: [1, 1], run_steady: [1, 1], calcetto: [1, 2],
  },
  other: {},
};

// Rigidità generale o energia bassa: scala di un livello.
export const DOWNGRADE = {
  legs_heavy: 'legs_light',
  legs_light: 'mobility',
  hills_short: 'run_easy',
  hills_long: 'run_easy',
  run_strides: 'run_easy',
  run_steady: 'run_easy',
  run_easy: 'mobility',
};

// Bloccate da quadricipiti induriti / dolore localizzato / fastidio che tira.
export const LEG_DEMANDING = LEG_RUN;
export const SPRINT_OR_HEAVY = ['legs_heavy', 'hills_short', 'hills_long', 'run_strides'];

// Obiettivi settimanali di riferimento (sedute/settimana).
export const SLOT_TARGETS = { legs: 1, pull: 1, push: 1, run: 1.5, quality: 1 };
export const SLOT_LABELS = {
  legs: 'Gambe', pull: 'Tirata', push: 'Spinta', run: 'Corsa', quality: 'Corsa di qualità',
};

// Punteggio di partenza: a parità di bisogno, cosa preferire.
export const BASE = {
  legs_heavy: 1.0, pull: 0.9, push: 0.8, hills_short: 0.8, hills_long: 0.7,
  run_strides: 0.6, run_steady: 0.4, run_easy: 0, legs_light: -0.6,
  mobility: -0.4, rest: 0,
};

export const GROUPS = {
  legs: { label: 'Gambe', color: 'var(--c-legs)' },
  pull: { label: 'Tirata', color: 'var(--c-pull)' },
  push: { label: 'Spinta', color: 'var(--c-push)' },
  run: { label: 'Corsa', color: 'var(--c-run)' },
  calcetto: { label: 'Calcetto', color: 'var(--c-calcetto)' },
  other: { label: 'Altro sport', color: 'var(--c-other)' },
  recovery: { label: 'Mobilità', color: 'var(--c-recovery)' },
  rest: { label: 'Riposo', color: 'var(--c-rest)' },
};
