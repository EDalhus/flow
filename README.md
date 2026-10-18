# Flow

Internt logistikksystem for kaia på Flatholmen i Ålesund. Menyen har fire hovedseksjoner:

| Seksjon | Innhold |
|---|---|
| **Båter** | Kart med AIS, anløp, kaibok og båtregister (underfaner øverst). Kartet kan vises som mørkt, lyst, satellitt eller hybrid; valget huskes per nettleser. |
| **Biler** | Kundebiler som henter pall og BB, sortert på forventet dag (ikke klokkeslett). Markeres «Hentet» når de har vært her. |
| **Bulkbil** | Egne biler som henter salt i bulk. Sjåføren bestiller kvalitet (havsalt, steinsalt, blandet salt, veisalt) og tonn på bilen, og kan legge til henger som et ekstra steg med pause (min:sek) imellom. Kontoret ser køen og kan fjerne en bestilling som ble feil eller ikke hentes; lastingen startes ikke fra Flow. |
| **Produksjon** | To pakkelinjer med 30 t silo hver. Viser hva som pakkes i bigbags nå, hva som er neste inn i siloen (med varsel ved kvalitetsbytte), beregnet nivå i siloen og når hjullasteren skal fylle eller stoppe. |

**Søk øverst på alle sider** finner sider, båter, anløp, biler, bulkbiler og folk i Flow. Med BarentsWatch-nøklene på plass søker det også i AIS (Kystverkets data) på navn, MMSI, IMO eller kallesignal – også båter som ikke er i båtregisteret. Fra treffet kan båten legges til i båtregisteret, og «Vis i kartet» viser hvor den er nå. BarentsWatch kan ikke søke på navn, så Flow henter alle fartøy de har sett siste 24 timer i norske farvann og filtrerer selv (listen holdes i minnet i tre minutter). Båter som ikke har vært i området det siste døgnet, blir ikke funnet.

Mannskap på anløp er valgfritt. Det ligger sammenfoldet på anløpet, og roller og personer kan legges til eller fjernes ved behov.

Rapporter og **Innstillinger** ligger nederst i menyen. Under Innstillinger → **Preferanser** velger hver bruker tema (mørkt, lyst eller som maskinen), språk og hvor langt fram kaiplanen viser. Hele grensesnittet finnes på norsk, engelsk, litauisk, dansk, svensk og islandsk, også varsler, feilmeldinger og tekster fra serveren. Navn på båter, kunder, varer og kaier, og det folk skriver i chatten, vises som det er lagt inn. Kaier og brukere ligger på samme side for admin. `/hjullaster` er en fullskjermvisning for nettbrettet i hjullasteren: behov i traktene, hvilke biler som har bestilt (sjåfør og tonn per kvalitet) og begge siloene. Skjermen er bare til visning. Knappen «Demo: påfylling av silo» viser hvordan siloene tømmes og fylles i produksjon, uten å lagre noe.

**Klokkeslett på anløp er valgfritt.** Tidene er sjelden kjent før ca. en time før båten kommer, så et anløp kan legges inn med bare dag. Tiden settes på anløpet («Sett tid») når den er kjent. Anløp uten tid er utenfor kollisjonssjekken og kaibelegget til tiden er satt.

**Kartbakgrunn:** Mørk og lys er flate sjøkart i Kystverket-stil (hav, land, veier og navn – uten terreng), laget av vektorfliser fra OpenFreeMap (OpenStreetMap-data, ingen nøkkel). Satellitt og hybrid bruker Esri World Imagery. Esris vilkår kan kreve en ArcGIS-konto ved kommersiell bruk; flyfoto fra Norge i bilder kan brukes i stedet hvis dere har tilgang.

**MVP:** Silonivået beregnes fra registrert påfylling (API-et `POST /api/production/fills`; knappene for påfylling er fjernet fra skjermene) og pakkehastigheten (standard 10 t/t per linje). Når sensorene på siloene kobles på, erstattes det beregnede nivået med målt verdi. Bulkbil viser og teller ned; styring av traktene kan kobles på senere.

Alt kjører i én Cloudflare Worker:

| Del | Teknologi |
|---|---|
| Frontend | React + Vite, servert som statiske filer fra Workeren |
| API | Hono under `/api` |
| Database | D1 (`flow-db`) |
| Bilder | R2 (`flow-photos`) |
| Sanntid | Durable Object (`QuayRoom`) med WebSocket |
| AIS | BarentsWatch, hentet av Cron Trigger hvert minutt |
| Innlogging | Cloudflare Access (Zero Trust) |
| Kart | MapLibre med vektorfliser fra OpenFreeMap (© OpenMapTiles, © OpenStreetMap-bidragsytere) |

Koden deployes fra GitHub med Cloudflare Workers Builds. Ingenting må kjøres lokalt.

---

## 1. Første oppsett (gjøres én gang)

Alt gjøres i [Cloudflare-dashbordet](https://dash.cloudflare.com) og på GitHub.

### 1.1 Database og bildelager

Disse trenger du ikke opprette selv. D1-databasen `flow-db` og R2-bøtta `flow-photos` opprettes automatisk ved første deploy, og tabellene lages fra filene i `migrations/`. R2 må likevel være aktivert på kontoen (**Storage & Databases → R2 Object Storage**); gratisnivået holder.

### 1.2 Koble GitHub-repoet

1. **Workers & Pages → Create → Import a repository** (Workers Builds). Velg GitHub-repoet.
2. Fyll inn:

   | Felt | Verdi |
   |---|---|
   | Project name | `flow` (må være lik `name` i `wrangler.jsonc`) |
   | Production branch | `main` |
   | Build command | `npm run build` |
   | Deploy command | `npm run deploy:cf` |
   | Root directory | `/` |

3. Valgfritt: under **Build → Build variables** (ikke under Variables and Secrets), legg til `SEED_DEMO` = `1` for eksempeldataene fra designet (båter, anløp, kaibøker og rapporttall). `1` legger bare inn hvis databasen er tom. Har du allerede data, bruk `force` i stedet – det tømmer databasen først. Fjern variabelen etter at deployen er ferdig.
4. **Save and Deploy**.

> **Viktig:** `npm run deploy:cf` må stå i **Deploy command**, ikke standardverdien `npx wrangler deploy`. Ellers kjøres ikke databasemigrasjonene. Skriptet bygger også appen selv, så det virker selv om det havner i Build command. Feltene finnes under **Settings → Build**.

Deploy-kommandoen (`scripts/deploy.mjs`) gjør dette i rekkefølge:

1. Kjører nye databasemigrasjoner. Ved aller første deploy finnes ikke databasen ennå, og steget hoppes over.
2. Deployer Workeren. Første gang opprettes D1 og R2 automatisk.
3. Kjører migrasjonene igjen. Det gjør ingenting hvis alt allerede er kjørt, men lager tabellene ved første deploy.
4. Legger inn eksempeldata hvis Build-variabelen `SEED_DEMO` er `1` (tom DB) eller `force` (tømmer først).

> **Hvis bygget feiler med en tilgangsfeil på D1 eller R2:** API-tokenet til Workers Builds mangler rettigheter. Gå til Workerens **Settings → Build → API token** og gi tokenet *D1: Edit* og *Workers R2 Storage: Edit*, eller lag et nytt token med malen «Edit Cloudflare Workers» pluss D1.
>
> **Bygg for andre grener enn `main`:** Slå av «Builds for non-production branches» under **Settings → Build**. Forhåndsversjoner deler den samme databasen, og migrasjoner kjøres bare fra `main`.

Etter første deploy ligger appen på `https://flow.<ditt-subdomene>.workers.dev` og kan brukes med en gang.

> **Uten innlogging:** Så lenge Cloudflare Access ikke er satt opp (steg 2), kjører Flow i *åpen modus*. Alle som kjenner adressen kan se og endre alt. Man velger hvem man er ved å trykke på avataren øverst til høyre; valget huskes i nettleseren. Standardbrukeren heter «Flow» og er admin.

---

## 2. Innlogging med Cloudflare Access (valgfritt, anbefalt)

Access kan slås på når som helst, uten kodeendringer. Når `ACCESS_AUD` og `ACCESS_TEAM_DOMAIN` er satt, slipper Flow bare inn brukere som Access har verifisert, og brukervalget forsvinner. Workeren sjekker selv signaturen i `Cf-Access-Jwt-Assertion` mot teamdomenet og AUD-taggen, så appen kan ikke nås forbi Access.

1. Gå til Workeren **flow → Settings → Domains & Routes**.
2. Ved `workers.dev`: velg **Enable Cloudflare Access**. Gjør det samme for **Preview URLs**, eller slå preview-URL-er av.
3. Vinduet som åpnes viser to verdier. Ta vare på dem til steg 3:
   - **TEAM_DOMAIN**, f.eks. `firma.cloudflareaccess.com`
   - **POLICY_AUD**, AUD-taggen: en lang heksadesimal streng

   Du finner dem også senere under **Zero Trust → Access → Applications → (flow) → Configure → Additional settings → Application Audience (AUD) Tag**.
4. Velg **Manage Cloudflare Access** og rediger policyen. Under *Include* velger du **Emails** og legger inn e-postene som skal ha tilgang. Bruk *Emails ending in* hvis alle har firma-e-post.
5. Innloggingsmetode: «verifiserte e-postadresser» betyr **One-time PIN**. Den er aktiv som standard under **Zero Trust → Settings → Authentication**. Brukeren skriver inn e-posten sin og får en engangskode.

Kilder: [Cloudflare Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

---

## 3. Variabler og secrets

Alt legges inn i dashbordet under **Workers & Pages → flow → Settings → Variables and Secrets → Add**. Ingenting av dette skal inn i koden. `keep_vars` i `wrangler.jsonc` sørger for at deploy fra GitHub ikke sletter verdiene.

| Navn | Type | Verdi |
|---|---|---|
| `ACCESS_TEAM_DOMAIN` | Text | Bare med Access: teamdomenet fra steg 2, f.eks. `firma.cloudflareaccess.com` |
| `ACCESS_AUD` | Text | Bare med Access: AUD-taggen fra steg 2 |
| `ADMIN_EMAILS` | Text | Bare med Access: din e-post, eventuelt flere adskilt med komma. Disse blir admin ved første innlogging. |
| `BW_CLIENT_ID` | **Secret** | Klient-ID fra BarentsWatch (se steg 5) |
| `BW_CLIENT_SECRET` | **Secret** | Klienthemmelighet fra BarentsWatch |

Nye verdier gjelder fra neste forespørsel; ny deploy trengs ikke.

---

## 4. Brukere

Gå til **Innstillinger** i menyen. Fanene **Kaier** og **Brukere** vises bare for admin. Under **Brukere** legger du til alle som skal bruke Flow:

- **E-post:** med Access må den være den samme som i Access-policyen.
- **Roller:** se tabellen under.
- **Kan stå som:** trucksjåfør, anhuker eller kaikran. Dette styrer hvem som kan velges i mannskapslistene.

Uten Access velger hver person seg selv i lista bak avataren. Med Access logger personene inn med e-posten sin. Den første innloggingen med en e-post fra `ADMIN_EMAILS` oppretter en admin, og personer som ikke er lagt inn får beskjed om å be en administrator legge dem til.

| Rolle | Kan |
|---|---|
| Salg | Opprette og endre anløp, sette antall roller, redigere båter |
| Produksjon | Alt salg kan, pluss sette navn og ansvarlig, overstyre flagg og levere kaibok |
| Kaiarbeider | Se alt, bruke chatten, levere kaibok med bilder |
| Admin | Alt, inkludert brukere, kaier (egne og nabo) og innstillinger |

Eksempeldataene (`SEED_DEMO`) inneholder testbrukere på `@flow.example`. De kan ikke logge inn, men vises i lister og chat. Deaktiver dem under **Brukere** når dere tar systemet i bruk.

---

## 5. AIS fra BarentsWatch

1. Registrer en API-klient med tilgang til AIS hos BarentsWatch ([developer.barentswatch.no](https://developer.barentswatch.no/docs/AIS/live-ais-api/)).
2. Legg inn `BW_CLIENT_ID` og `BW_CLIENT_SECRET` som **secrets** (steg 3).
3. Legg inn **MMSI** på båtene: **Båter → velg båt → Rediger**. AIS henter bare båter som har MMSI.

Cron-jobben kjører hvert minutt:

- **Henting:** Den henter siste posisjon for båtene i kaiboka og lagrer posisjon og spor for de siste 6 timene.
- **Trafikkbildet:** Den henter også alle fartøy i et område på ca. 150 × 150 km rundt kaia, og bygger opp spor for de siste 12 minuttene (tabellen `ais_area`, én rad).
- **Ved kai:** Båten er innenfor geofencen (300 m rundt Flatholmen havn 81B) med fart under 3 knop, og har et anløp med ETA innenfor ±12 timer. Anløp uten klokkeslett regnes med ETA midt på dagen.
- **Kaibok mangler:** Båten har forlatt geofencen uten at kaiboka er levert.
- **Uten AIS-posisjon:** Status anslås ut fra ETA og ETD, og merket viser at det er et anslag. Anløp uten klokkeslett står som planlagt til AIS melder båten.

På kartet vises trafikken som i Kystverkets kart:

- Skipene er farget etter type (fiske, last, tank, passasjer osv.). Våre båter er turkise med navnet i fet skrift; klikk på en båt med anløp hos oss åpner anløpet. Andre båter kan skjules eller gjøres grå med knappene i fargeforklaringen. Trykk på en type (f.eks. Tank eller Fritid) for å skjule den. Slideren **Område** begrenser andre båter til 5–75 km fra kaia; **Hele kysten** viser alle fartøy i Kystverkets AIS-dekning innenfor kartutsnittet (`GET /api/ais/coast`, hentes hvert minutt mens valget er på, uten spor).
- Stiplet linje er sporet de siste 12 minuttene. Hvit linje viser hvor fartøyet er om 6 minutter med farten og kursen det holder nå.
- Klikk på et skip for stevning, kurs, fart, destinasjon, posisjon og når det sist meldte seg. Kortet viser også distanse og omtrentlig tid til vår kai langs sjøveien (korteste vei over vann, beregnet i nettleseren fra kartdataene; luftlinje hvis ingen vei finnes), og ringer for hvor langt skipet kommer på 6, 12, 24, 36, 48 og 60 minutter og 3 timer.
- Sporet for det siste døgnet hentes fra BarentsWatch sitt historikk-API når et skip velges. Det bruker samme nøkler.

**Kaiplanen** nederst på kartet viser 24 timer, 3, 7 eller 14 dager. 7 dager er standard, og hver bruker velger selv (lagres på brukeren). Anløp uten klokkeslett vises som stiplet heldagsfelt. Ferdige anløp vises ikke under Anløp; de ligger i Kaibok.

**Bilder av båten:** I båtregisteret (og under Båtprofil på anløpet) kan salg, produksjon og kaiarbeidere laste opp bilder av rampe, sideport, heis, lasterom, dekk og kran, med en kort beskrivelse. Bildene skaleres ned på telefonen og lagres i R2 (`flow-photos`). Den som lastet opp, eller salg/produksjon, kan slette.

AIS-status vises ikke på kartet. Hvis AIS ikke er satt opp, eller siste henting fra BarentsWatch feilet, kommer det et varsel i bjella. Admin kan åpne varselet og kjøre AIS-sjekken derfra.

BarentsWatch sine data utelater fiskefartøy under 15 m og fritidsbåter under 45 m, og dekker norsk økonomisk sone.

---

## 6. Bilder i kaiboka

Når en kaiarbeider tar bilde i kaibok-skjemaet:

1. Telefonen skalerer bildet ned til WebP (JPEG på eldre Safari), maks 2048 px, pluss et miniatyrbilde på 400 px. Et mobilbilde på flere MB blir typisk 50–500 kB.
2. Bildet lastes opp mens resten av skjemaet fylles ut, og lagres i R2 under `kaibok/<anløp>/<bilde>.webp`.
3. Bildene vises bare til innloggede brukere.

Bilder som lastes opp uten at kaiboka lagres, ryddes bort hver natt kl. 03:17 UTC.

---

## 7. Videre utvikling og deploy

- **Deploy:** Push til `main` bygger og deployer automatisk.
- **Databaseendringer:** Legg til en ny fil i `migrations/` (`0002_….sql`, `0003_….sql` osv.). Den kjøres automatisk ved neste deploy. Gamle migrasjoner skal aldri endres.
- **Bygget feiler hvis typesjekken feiler:** `npm run build` kjører `tsc` før Vite.
- **Tester:** API-et og forretningslogikken har tester under `worker/test/` (`npm test`). De kan kjøres i CI, for eksempel i en GitHub Action.
- **Språk:** All tekst skrives på norsk i koden og sendes gjennom `tr('Norsk tekst {navn}', { navn })` (`web/src/lib/i18n.ts`). Oversettelsene ligger i `web/src/i18n/<språk>.ts` med den norske teksten som nøkkel; flertall skrives som `entall|flertall` (litauisk `one|few|other`). Tekst som lages på serveren står i `web/src/i18n/server.ts` og oversettes med `tx()`. `npm run i18n:check` viser tekster som mangler i et språk.

### Prosjektstruktur

```
migrations/        D1-skjema
seed/              generator for eksempeldata
scripts/           deploy-hjelpere (eksempeldata)
shared/            delt mellom API og frontend: regler (status, kollisjoner, flagg, prognose), zod-skjemaer, typer
worker/            API (Hono), Access-sjekk, Durable Object, AIS, bilder, tester
web/src/           React-frontend: sider, komponenter, kart, mobilvisning
wrangler.jsonc     bindinger: D1, R2, Durable Object, cron, statiske filer
```

---

## 8. Feilsøking

| Melding / symptom | Løsning |
|---|---|
| «Cloudflare Access er delvis konfigurert» | `ACCESS_AUD` er satt, men `ACCESS_TEAM_DOMAIN` mangler (steg 3). Fjern begge for åpen modus. |
| «Ugyldig eller utløpt innlogging» | Feil AUD-tag eller teamdomene, eller Access er ikke slått på for adressen du bruker (steg 2). |
| «… har ikke tilgang til Flow» | Personen er sluppet inn av Access, men ikke lagt inn under **Brukere** (steg 4). |
| Appen svarer med databasefeil («no such table») | Deploy command er ikke `npm run deploy:cf`, så migrasjonene har ikke kjørt (steg 1.2). |
| Bygget feiler på `d1 migrations apply` | Byggtokenet mangler D1-rettighet (steg 1.2). |
| Bygget feiler med R2-feil | R2 er ikke aktivert på kontoen (steg 1.1). |
| Kartpillen viser «BarentsWatch-nøkler mangler» | Legg inn secrets (steg 3). |
| Kartpillen viser «Ingen båter i kaiboka har MMSI ennå» | Legg inn MMSI på båtene (steg 5). |

Logger finnes under **Workers & Pages → flow → Observability/Logs**, og bygglogger under **Deployments**.

---

## Videre arbeid

- Skjerm for vakter per dag. API-et finnes (`/api/shifts`); i dag brukes standardkapasiteten 4 truck, 3 anhuker og 1 kaikran når vakt ikke er registrert.
- Skjerm for innstillinger: geofence, flaggterskler og buffer. API-et finnes (`PUT /api/settings`, admin).
- Varsler på e-post eller push i tillegg til bjella.
- Import av ekte historikk til rapportene, slik at de oppdiktede tallene erstattes.
- Silosensorer i stedet for beregnet nivå, og styring av traktene for bulkbil.
- Skjerm for å endre pakkehastighet og silostørrelse per linje. API-et finnes (`PATCH /api/production/lines/:id`).
