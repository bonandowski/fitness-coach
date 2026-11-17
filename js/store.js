// Persistenza locale (localStorage) + backup JSON.
const KEY = 'fitcoach.v1';

export const emptyState = () => ({
  version: 1,
  entries: [],
  checkins: {},
  flags: { pain: false },
  settings: {},
  meta: { lastExport: null, createdAt: new Date().toISOString() },
});

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const s = JSON.parse(raw);
    return { ...emptyState(), ...s, meta: { ...emptyState().meta, ...(s.meta || {}) } };
  } catch {
    return emptyState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// Chiede al browser di non cancellare mai i dati (Android/desktop; su iOS
// la protezione vera arriva aggiungendo l'app alla schermata Home).
export async function persist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}

export async function exportJSON(state) {
  const name = `fitcoach-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const file = new File([blob], name, { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Backup allenamenti' });
      return true;
    }
  } catch (err) {
    if (err?.name === 'AbortError') return false;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

export async function importJSON(file) {
  const s = JSON.parse(await file.text());
  if (!s || !Array.isArray(s.entries)) throw new Error('File non valido');
  return { ...emptyState(), ...s };
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
