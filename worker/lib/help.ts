// Brukerhåndbok for Flow, til «Spør Flow» (hjelp i bruk). Claude svarer ut fra denne teksten og lenker til sidene.
// Holdes kort og konkret; oppdater når sider eller arbeidsflyt endres.

export const HELP_FLOW = `
# Flow – slik gjør du det (Flatholmen havn 81B)

## Sider (lenker)
- Kart: / – båtene i AIS, kaiplanen nederst, hovedtall. Klikk en båt for detaljer; klikk et anløp for anløpspanelet.
- Anløp: /anlop – båtene de neste dagene. Fanen Salgsordre: /anlop?vis=ordre (SO fra Dynamics 365).
- Kaibok (ferdige anløp og kaibøker): /kaibok
- Båtregister: /baater
- Biler (kundebiler som henter pall/BB): /biler
- Bulkbil (bulksalt på bil): /bulk – faner Kø, Veiinger (/bulk?vis=veiinger), Rapport (/bulk?vis=rapport), Register (/bulk?vis=register)
- Sjåførvisning (egen innlogging for sjåfører): /sjafor
- Produksjon (pakkelinjer og silo): /produksjon
- Hjullasterskjerm: /hjullaster
- Rapporter (tonn per uke, produkter, kvalitet): /rapporter
- Innstillinger: /innstillinger – Preferanser (tema, språk, kaiplan), Kaier og Brukere (bare admin)
- Mobilvisning for kaia: /m

## Salgsordre og anløp
- Ordren er sannheten: et anløp er en båt som kommer for å hente varene på én eller flere SO-er (salgsordre), eller levere varer inn på PO-er (innkjøpsordre).
- Ny ordre: /anlop?vis=ordre → «Ny SO / PO». Velg Type: Henting gir SO-nummer fra Dynamics 365 (20 + fem siffer); Levering gir PO-nummer (f.eks. PO-000123). Kunde/leverandør, varer (BB eller pall) og båt: «Ingen båt ennå», «Planlagt båt» eller «Ny båt» (lager anløpet).
- Båten kan bli ferdig en annen dag enn den kommer: i anløpet → «Endre» ved klokkeslett → sett «Ferdig (dag)» og ETD (maks 14 døgn). Anløpet vises da alle dagene det varer.
- Legge en SO på en båt: åpne SO-en → «Legg på båt», eller i anløpspanelet → «Legg til SO som venter på båt …». En båt kan ta flere SO-er; lasterekkefølgen settes under «Salgsordre · lasterekkefølge» i anløpspanelet. Bytte båt for én SO: åpne SO-en → «Bytt båt / flytt»; for hele anløpet: anløpspanelet → «Bytt båt».
- Flytte et anløp (tid eller kai): åpne anløpet i kartet eller på /anlop → «Endre». Kollisjoner på kaia varsles i bjella med forslag («Løs»).
- Avlyse: anløpspanelet (Oversikt, nederst) → «Avlys anløpet» (begrunnelse kreves); anløpet blir stående som avlyst. Slette helt (lagt inn ved en feil): «Slett anløpet» samme sted. SO/PO-ene går tilbake til «venter på båt». Ikke mulig etter at kaiboka er levert. Alle endringer logges (fanen Endringer).
- Chat per anløp: anløpspanelet → Chat. Skriv @Navn for å varsle noen.

## Kaibok
- Når båten er ferdig: åpne anløpet → «Ferdigstill og fyll ut kaibok». Avvik ja/nei, kategorier, beskrivelse, bilder (mobilkamera), stjerner for punktlighet, samarbeid og utstyr, og notat til båtprofilen.
- «Fortell med egne ord» øverst: skriv eller snakk inn, så fyller Flow ut skjemaet. Sjekk før du lagrer.
- Flagg på båter (grønt/gult/rødt) regnes fra kaibøkene; produksjon kan overstyre i båtprofilen med begrunnelse.

## Båter
- Ny båt: /baater → «Ny båt» (navn, MMSI for AIS, IMO, kallesignal, agent, kontakt om bord). Fra søket: finn båten i AIS → «Legg til i båtregisteret».

## Biler (kundebiler)
- Ny henting: /biler → «Ny henting»: SO-nummer, kunde, transportør, reg.nr., forventet dag og varer. Trykk «Utlevert» når varene er levert ut til bilen.

## Bulkbil
- Sjåførene laster selv i sjåførvisningen (/sjafor): logger inn med telefonnummer og PIN, velger bil, kunde (prosjektnummer hvis kunden krever det), kvalitet og tonn, nå eller ca. tid. Start lasting → veid tonn fra vekta → «Bil ferdig» → flytt henger → «Start henger» → ferdig. Følgeseddel (PDF) lages automatisk. NØDSTOPP-knappen stopper og varsler produksjonen.
- Ny sjåfør: /bulk?vis=register → Sjåfører → «Ny sjåfør»: navn, telefon (brukes til innlogging), transportfirma og PIN (4–6 siffer). Gi sjåføren adressen /sjafor, telefonnummeret og PIN-en.
- Ny bil: /bulk?vis=register → Biler → «Ny bil»: reg.nr., transportfirma, med eller uten henger.
- Ny kunde: /bulk?vis=register → Kunder (huk av «Krever prosjektnummer» om nødvendig). Nytt transportfirma: samme sted.
- Glemt PIN eller låst konto (fem feil): sett ny PIN på sjåføren i registeret; det låser opp og logger ut overalt.
- Kontoret kan bestille for en sjåfør i Kø-fanen (Bestill lasting) og fjerne ordre som ble feil. Dagens veiinger og rapporter (per kvalitet, kunde, bil, sjåfør, transportør, prosjekt, dag) kan lastes ned som CSV/Excel.

## Produksjon
- /produksjon: pakkelinjene, hva som pakkes nå og neste, silonivå. Ny pakkeordre: «Ny pakkeordre» → linje, produkt og tonn → «Legg i kø».

## Søk og Spør Flow
- Søkefeltet øverst (Ctrl/⌘ K): båter, SO, biler, folk, AIS. «ny bulk SU 20 110», «ny bil …», «ny so …», «ny båt …» åpner skjemaet ferdig utfylt. Datoer («i morgen», «uke 43») viser hva som skjer. Prefiks: båt:, so:, bil:, sjåfør:, kunde:, kai:, person:.
- Spør Flow: still spørsmål med vanlige ord, eller be Flow gjøre en jobb (f.eks. flytte et anløp) – du bekrefter med «Utfør».

## Brukere og tilgang
- Nye brukere og roller: /innstillinger → Brukere (bare admin). Roller: salg, produksjon, kaiarbeider, admin. Med Cloudflare Access må e-posten også stå i Access-policyen.
- Språk og tema: /innstillinger → Preferanser (norsk, engelsk, litauisk, dansk, svensk, islandsk; mørk/lys).
`;

/** Hjelp for sjåførene i sjåførvisningen (de har ikke tilgang til resten av Flow). */
export const HELP_DRIVER = `
# Sjåførvisningen i Flow (Flatholmen havn) – bulksalt på bil

- Innlogging: telefonnummeret ditt og PIN-koden du har fått av kontoret. Fem feil PIN låser kontoen i ti minutter. Glemt PIN: ring kontoret, de setter en ny.
- Språk: trykk på flagget øverst.
- Ny lasting: «+ Ny lasting» → velg bil (reg.nr.), hvem som skal ha saltet (noen kunder krever prosjektnummer), ev. SO-nummer, «Nå – jeg er her» eller «Senere (ca. tid)», kvalitet og tonn for bil, og «Legg til henger» hvis du har henger.
- Lasting: trykk «Start lasting» når bilen står under utlastingen. Når bilen er full: skriv inn veid tonn fra vekta og trykk «Bil ferdig». Flytt hengeren under utlastingen og trykk «Start henger». Til slutt veid tonn og «Ferdig – lag følgeseddel».
- NØDSTOPP: den røde knappen stopper lastingen og varsler kontoret og produksjonen. Trykk «Fortsett lasting» når det er trygt.
- Avbestille: «Avbestill» før lastingen er startet. Etter start: ring kontoret.
- Følgeseddel: under «Ferdig i dag» → «Følgeseddel nr. … (PDF)». Den er alltid på norsk.
- Bil mangler i lista: bilen må legges inn av kontoret på ditt transportfirma.
`;
