# Euristiche del coach

Le regole sono in `js/catalog.js` (dati) e `js/engine.js` (logica).
Le tue euristiche originali sono tutte presenti; quelle con **[nuova]** le ho aggiunte io.

## 1. Finestre minime di recupero

Ogni coppia "seduta A → seduta B" ha due soglie in giorni:
- **hard**: sotto questa soglia B è vietata;
- **ideal**: tra hard e ideal B è permessa ma penalizzata.

Valgono in entrambe le direzioni: "dopo le gambe pesanti aspetta 2 giorni per gli sprint" significa anche "prima di una seduta di sprint già in programma, niente gambe pesanti nei 2 giorni precedenti".

| Dopo… | Gambe pesanti | Gambe leggere | Sprint salita | Ripetute salita | Allunghi | Corsa costante | Stesso gruppo alto |
|---|---|---|---|---|---|---|---|
| Gambe pesanti | 2 (ideale 3) | 2 | 2 | 2 (3) | 1 (2) | 1 | – |
| Sprint salita 10-15" | 2 | 1 | 2 | 2 | 1 | 1 | – |
| Ripetute 30-40" | 2 | 1 (2) | 2 (3) | 2 (3) | 1 (2) | 1 | – |
| Calcetto | 3 | 2 | 2 | 3 | 2 | 2 | parte alta ok a +1 |
| Beach volley **[nuova]** | 2 | 1 | 2 | 2 | 1 (2) | 1 | spinta +1 (spalle) |
| Montagna **[nuova]** | 2 (3) | 1 (2) | 1 (2) | 2 | 1 | 1 | – |
| Spinta | – | – | – | – | – | – | spinta 2 |
| Tirata | – | – | – | – | – | – | tirata 2 |
| Calisthenics **[nuova]** | – | – | – | – | – | – | tirata 2, spinta 1 (2) |

Modificatori:
- **Seduta blanda** (RPE ≤ 4) su un'attività dura: tutto scala di un giorno (calcetto blando = 24-36h).
- **Seduta al limite** (RPE ≥ 9): +1 giorno alla finestra ideale. **[nuova]**
- **Montagna**: oltre 4h +1 giorno, sotto 2h −1 giorno (la discesa è il vero carico sui quadricipiti). **[nuova]**
- **Mai due sedute dure per le gambe consecutive**: gambe pesanti, sprint, ripetute, calcetto, beach volley e montagna oltre 2h30 richiedono sempre almeno 2 giorni tra loro.
- **Gambe e salite nello stesso giorno**: vietato (finestra ≥ 1).

## 2. Calcetto

- Niente gambe pesanti nei 3 giorni prima (le tue 48h, arrotondate a 3 giorni di calendario, come nel tuo esempio "se il calcetto è tra meno di 3 giorni sposta le gambe").
- Sprint e salite: ok fino a 2 giorni prima, mai il giorno prima.
- Il giorno prima: solo defaticante da 20' (bonus forte, ti piace) o riposo.
- Il giorno stesso: niente altro.
- **Calcetto probabile [nuova]**: se non segni nulla, la domenica è considerata "probabile calcetto". Le regole sopra diventano penalità forti invece di divieti, e il dopo partita viene pianificato come se avessi giocato. Un tap su "niente calcetto" libera il piano.

## 3. Segnali soggettivi (priorità massima)

Check-in sulla card di oggi:
- **Gambe indurite**: vietati gambe e corsa impegnativa. Defaticante consigliato (scioglie). Parte alta e mobilità ok. Domani penalità su gambe pesanti e sprint. **[estesa]**
- **Dolore localizzato**: vietata qualunque corsa e qualunque seduta gambe. Anche domani niente gambe pesanti o sprint. **[estesa]**
- **Rigidità generale** o **energia bassa**: scala di un livello. Gambe pesanti → gambe leggere, sprint/salite/allunghi/costante → defaticante, defaticante → mobilità, gambe leggere → mobilità. Parte alta: stessa seduta con un terzo di volume in meno.
- **Energia alta [nuova]**: piccolo bonus alle sedute dure.
- **Fastidio che tira** (inguine, adduttori, flessori): interruttore che resta attivo finché non lo spegni. Blocca gambe pesanti, sprint, salite e allunghi su tutto il piano. Pensato anche per l'ernia.

## 4. Bisogno settimanale

Obiettivi di riferimento: 1 gambe, 1 tirata, 1 spinta, 1-2 corse (1,5), di cui 1 di qualità (salite o allunghi).

Per ogni obiettivo il coach calcola quanto è in ritardo rispetto all'intervallo ideale (7 giorni ÷ obiettivo). Più è in ritardo, più punti prende la seduta che lo copre. Coperture parziali:
- gambe leggere = ½ gambe;
- defaticante = ½ corsa;
- calisthenics = 0,7 tirata + 0,7 spinta;
- allunghi = corsa + 0,6 qualità.

## 5. Equilibrio e prevenzione **[nuove]**

- **Volume**: obiettivo 4-5 giorni di allenamento ogni 7 (impostabile). Oltre, ogni giorno extra è penalizzato.
- **Giorni di fila**: dal 3° giorno consecutivo la penalità cresce. Dopo 6 giorni senza riposo il riposo diventa quasi obbligato.
- **Due riposi di fila**: lievemente penalizzati se non servono.
- **Alternanza duro/facile**: una seduta dura il giorno dopo un'altra seduta dura (anche di gruppi diversi) è penalizzata.
- **Alternanza spinta/tirata**: bonus alla parte alta opposta all'ultima fatta.
- **Postura**: se nelle ultime 4 settimane hai fatto più spinta che tirata, la tirata prende un bonus. Nelle statistiche il rapporto tirata:spinta deve restare ≥ 1.
- **Varietà nella corsa**: tra sprint, ripetute e allunghi è favorita quella fatta meno di recente.
- **Carico acuto/cronico (ACWR)**: carico = minuti × RPE. Settimana / media delle ultime 4. Sopra 1,3 le sedute dure sono penalizzate e il riposo favorito, sopra 1,5 molto di più. Si attiva dopo 3 settimane di dati.
- **Rientro dopo una pausa**: nessun allenamento da 10 giorni → nei primi 3 giorni le sedute dure sono penalizzate.
- **Giorni di riposo preferiti**: sabato e domenica di default.
- **Ernia**: nessun esercizio è vietato a livello macro, ma ogni seduta di forza ricorda di espirare in spinta e di evitare l'apnea. Squat e stacchi non vengono mai proposti.

## 6. Pianificazione

Il coach non sceglie giorno per giorno in modo miope. Esplora fino a 60 sequenze candidate sui prossimi 9 giorni (beam search) e sceglie quella con il punteggio totale più alto. Ogni giorno in cui un obiettivo resta in ritardo costa un po' di "debito", quindi rimandare senza motivo non conviene.

Esempio: calcetto domenica, gambe ferme da 8 giorni. Il coach piazza le gambe pesanti entro giovedì (ultima finestra utile) e lascia sabato per il defaticante, invece di proporre gambe venerdì.

I giorni che pianifichi tu sono fissi. Se un tuo piano viola una regola, vedi l'avviso e un'alternativa a un tap.
