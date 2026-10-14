# Flow

Internt logistikksystem for kaia på Flatholmen i Ålesund: planlegging av anløp, mannskap, kaibok, båtprofiler og rapporter, med kart og AIS.

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
| Kart | MapLibre med Kartverkets åpne kart (© Kartverket, CC BY 4.0) |

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

3. Valgfritt, bare første gang: under **Build variables**, legg til `SEED_DEMO` = `1` for å få eksempeldataene fra designet (båter, anløp, kaibøker og oppdiktede rapporttall for 2025/2026). De legges bare inn hvis databasen er tom, så eksisterende data blir aldri overskrevet. Fjern variabelen etterpå.
4. **Save and Deploy**.

> **Viktig:** `npm run deploy:cf` må stå i **Deploy command**, ikke standardverdien `npx wrangler deploy`. Ellers kjøres ikke databasemigrasjonene. Skriptet bygger også appen selv, så det virker selv om det havner i Build command. Feltene finnes under **Settings → Build**.

Deploy-kommandoen (`scripts/deploy.mjs`) gjør dette i rekkefølge:

1. Kjører nye databasemigrasjoner. Ved aller første deploy finnes ikke databasen ennå, og steget hoppes over.
2. Deployer Workeren. Første gang opprettes D1 og R2 automatisk.
3. Kjører migrasjonene igjen. Det gjør ingenting hvis alt allerede er kjørt, men lager tabellene ved første deploy.
4. Legger inn eksempeldata, hvis `SEED_DEMO=1` og databasen er tom.

> **Hvis bygget feiler med en tilgangsfeil på D1 eller R2:** API-tokenet til Workers Builds mangler rettigheter. Gå til Workerens **Settings → Build → API token** og gi tokenet *D1: Edit* og *Workers R2 Storage: Edit*, eller lag et nytt token med malen «Edit Cloudflare Workers» pluss D1.
>
> **Bygg for andre grener enn `main`:** Slå av «Builds for non-production branches» under **Settings → Build**. Forhåndsversjoner deler den samme databasen, og migrasjoner kjøres bare fra `main`.

Etter første deploy ligger appen på `https://flow.<ditt-subdomene>.workers.dev`. Den svarer «Cloudflare Access er ikke konfigurert» til du har gjort steg 2 og 3. Det er med vilje: uten Access slipper ingen inn.

---

## 2. Innlogging med Cloudflare Access

Flow slipper bare inn brukere som Access har verifisert. Workeren sjekker selv signaturen i `Cf-Access-Jwt-Assertion` mot teamdomenet og AUD-taggen, så appen kan ikke nås forbi Access.

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
| `ACCESS_TEAM_DOMAIN` | Text | Teamdomenet fra steg 2, f.eks. `firma.cloudflareaccess.com` |
| `ACCESS_AUD` | Text | AUD-taggen fra steg 2 |
| `ADMIN_EMAILS` | Text | Din e-post, eventuelt flere adskilt med komma. Disse blir admin ved første innlogging. |
| `BW_CLIENT_ID` | **Secret** | Klient-ID fra BarentsWatch (se steg 5) |
| `BW_CLIENT_SECRET` | **Secret** | Klienthemmelighet fra BarentsWatch |

Nye verdier gjelder fra neste forespørsel; ny deploy trengs ikke.

---

## 4. Første innlogging og brukere

1. Åpne appen og logg inn med en e-post fra `ADMIN_EMAILS`. Brukeren opprettes automatisk som admin.
2. Gå til **Brukere** i menyen; den vises bare for admin. Legg til alle som skal bruke Flow:
   - **E-post:** samme e-post som i Access-policyen.
   - **Roller:** se tabellen under.
   - **Kan stå som:** trucksjåfør, anhuker eller kaikran. Dette styrer hvem som kan velges i mannskapslistene.
3. En person som ikke er lagt inn, får beskjed om å be en administrator legge dem til, selv om Access slipper dem gjennom.

| Rolle | Kan |
|---|---|
| Salg | Opprette og endre anløp, sette antall roller, redigere båter |
| Produksjon | Alt salg kan, pluss sette navn og ansvarlig, overstyre flagg og levere kaibok |
| Kaiarbeider | Se alt, bruke chatten, levere kaibok med bilder |
| Admin | Alt, inkludert brukere og innstillinger |

Eksempeldataene (`SEED_DEMO`) inneholder testbrukere på `@flow.example`. De kan ikke logge inn, men vises i lister og chat. Deaktiver dem under **Brukere** når dere tar systemet i bruk.

---

## 5. AIS fra BarentsWatch

1. Registrer en API-klient med tilgang til AIS hos BarentsWatch ([developer.barentswatch.no](https://developer.barentswatch.no/docs/AIS/live-ais-api/)).
2. Legg inn `BW_CLIENT_ID` og `BW_CLIENT_SECRET` som **secrets** (steg 3).
3. Legg inn **MMSI** på båtene: **Båter → velg båt → Rediger**. AIS henter bare båter som har MMSI.

Cron-jobben kjører hvert minutt:

- **Henting:** Den henter siste posisjon for båtene i kaiboka og lagrer posisjon og spor for de siste 6 timene.
- **Ved kai:** Båten er innenfor geofencen (300 m rundt Flatholmen havn 81B) med fart under 3 knop, og har et anløp med ETA innenfor ±12 timer.
- **Kaibok mangler:** Båten har forlatt geofencen uten at kaiboka er levert.
- **Uten AIS-posisjon:** Status anslås ut fra ETA og ETD, og merket viser at det er et anslag.

Pillen øverst på kartet viser «AIS live» når det har kommet data de siste 5 minuttene. Ellers viser den hva som mangler, for eksempel nøkler, MMSI eller en feil fra BarentsWatch.

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
| «Cloudflare Access er ikke konfigurert» | `ACCESS_AUD` eller `ACCESS_TEAM_DOMAIN` mangler (steg 3). |
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
