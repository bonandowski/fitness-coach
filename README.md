# Coach

Webapp personale per pianificare gli allenamenti: storico, consiglio di oggi e piano dei prossimi giorni, con un motore a regole (senza LLM) che si adatta a recuperi, calcetto e segnali soggettivi.

- **Piano**: ultimi giorni, card di oggi con check-in rapido (gambe, rigidità, energia, fastidio) e consiglio motivato, prossimi 7 giorni.
- **Statistiche**: equilibrio della settimana, carico acuto/cronico, sedute per settimana per tipo, ultimi 30 giorni.
- **Impostazioni**: giorno del calcetto, giorni di riposo preferiti, frequenza, backup.

Le regole sono descritte in [docs/EURISTICHE.md](docs/EURISTICHE.md).

## Struttura

```
index.html           shell dell'app (PWA)
css/styles.css       stile, chiaro/scuro automatico
js/catalog.js        attività, finestre di recupero, obiettivi (i dati delle regole)
js/engine.js         motore: vincoli, punteggio, beam search
js/stats.js          statistiche
js/store.js          localStorage, backup JSON
js/app.js            interfaccia
sw.js                funzionamento offline
tests/               test del motore
```

Nessuna dipendenza e nessuna build: sono file statici.

## Sviluppo

```bash
python3 -m http.server 8000
```

```bash
npm test
```

## Pubblicazione

Funziona su qualsiasi hosting statico (Vercel, Netlify, GitHub Pages). Serve HTTPS perché il service worker funzioni.

## Dati

I dati restano nel browser del telefono (localStorage). Su iPhone aggiungi l'app alla schermata Home e usala sempre da lì: Safari altrimenti può cancellare i dati di un sito non visitato da 7 giorni, e l'app installata ha uno spazio separato da Safari. Fai un backup ogni tanto da Impostazioni (l'app te lo ricorda ogni 2 settimane).
