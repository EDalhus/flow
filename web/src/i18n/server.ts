// Tekster som lages på serveren eller i delt kode (varsler, kollisjoner, flaggbegrunnelser,
// feilmeldinger, faste etiketter) og vises som de er. De oversettes i nettleseren med tx(), og må
// derfor også stå i ordbøkene. Listen sjekkes av scripts/i18n-check.mjs. {navn} er verdier som settes inn.
export const SERVER_TEXTS = [
  // Tekster i tabeller i koden som sendes til tr() (sjekken finner ikke disse selv)
  'Båter', 'Biler', 'Bulkbil', 'Produksjon', 'Kart', 'Anløp', 'Kaibok', 'Båtregister', 'Hjullasterskjerm', 'Rapporter',
  'Innstillinger', 'Preferanser', 'Salg', 'Kaiarbeider', 'Admin',
  'Rampe', 'Sideport', 'Heis', 'Lasterom', 'Dekk', 'Kran',
  'Mørk', 'Lys', 'Satellitt', 'Hybrid',
  'Bestilt', 'Lastes', 'Ferdig', 'Fjernet',
  'Våre båter', 'Fiske', 'Last', 'Tank', 'Passasjer', 'Hurtigbåt', 'Los/redning', 'Fritid', 'Andre båter',
  'Punktlighet', 'Samarbeidsvilje (mannskap)', 'Båtens utstyr / kran', 'båtens utstyr',
  'Dårlig', 'Svak', 'Ok', 'Bra', 'Svært bra',
  'Fyll nå', 'Fyll snart', 'Nok i siloen', 'Stopp – nok til å fullføre ordren', 'Ingen ordre pakkes',
  'Alle', 'Rødt', 'Gult', 'Grønt',
  'Grønt', 'Gult varsel', 'Rødt flagg', 'Ingen historikk',
  'Pakkelinje {n}', 'BB + pall', 'Pall', 'BB', 'Bulk', 'BB + bulk', 'Pall + bulk', 'BB + pall + bulk', '{n} t {produkt} (bulk)',
  '{n} pall {produkt} · 25 kg × {sekker} · Europall', '{n} pall {produkt} · 25 kg × {sekker} · SRS-pall',
  'Flyttet {båt} til {kai} (fra varsel om kollisjon).', 'Utsatt {båt} til {tid} (fra varsel om kollisjon).',
  'Tid ikke satt',
  'På båt', 'Delvis på båt', 'Kansellert',

  // Salgsordre
  'Fant ikke salgsordren.', 'Salgsordren er endret av noen andre. Last inn på nytt og prøv igjen.', 'Salgsordren er kansellert.',
  'SO {so} finnes allerede ({kunde}).', 'SO {so} finnes allerede.', 'Ukjent salgsordre.', 'SO {so} er kansellert.',
  'SO {so} har ingen varer som venter på båt.', 'Ukjent varelinje.', 'Varer som er levert kan ikke endres.', 'Varer som er levert kan ikke flyttes.',
  'Kan ikke flytte mer enn det som står på linjen.', 'Ingen varer å flytte – alt på ordren er levert.', 'Varene ligger allerede der.',
  'Lasterekkefølgen må inneholde alle SO-ene på anløpet.', 'SO {so} på {båt} er endret av {navn}',

  // Etiketter i shared/domain
  'Trucksjåfør', 'Anhuker', 'Kaikran', 'trucksjåfører', 'anhukere', 'kaikraner',
  'trucksjåfør', 'anhuker', 'kaikran',
  'Skade på gods', 'Utstyr / kran', 'Mannskap / HMS', 'Forsinkelse', 'Annet',
  'skade på gods', 'utstyr / kran', 'mannskap / hms', 'forsinkelse', 'annet',
  'Fiskefartøy', 'Slep', 'Mudring/undervannsarbeid', 'Dykkeoperasjoner', 'Militært', 'Seilbåt', 'Fritidsbåt',
  'Hurtiggående fartøy', 'Losbåt', 'Redningsfartøy', 'Slepebåt', 'Havnefartøy', 'Politi', 'Passasjerskip',
  'Lasteskip', 'Tankskip', 'Annet fartøy',
  'punktlighet', 'samarbeidsvilje', 'utstyr / kran',

  // Kollisjoner og forslag
  '{kai} dobbeltbooket', '{navn} står på begge', '{n} {roller} trengs, {vakt} på vakt',
  'Flytt til {kai}', 'Flytt til annen kai', 'Utsett til {tid}',
  '{båt}: flytt til {kai}', '{båt}: utsett til {tid}', 'Det andre anløpet',

  // Flagg
  'Ny i kaiboka – ingen erfaringer ennå.', 'Lav snittvurdering: {snitt} av 5.', '{kategorier} ved et av de siste anløpene.',
  'Snittvurdering {snitt} av 5.', 'Lav {hva}.', 'Avvik ved forrige anløp.', 'Avvik ved forrige anløp ({kategorier}).',
  'Ingen avvik siste {n} anløp.', 'Ingen avvik ved forrige anløp.',

  // Varsler og systemmeldinger
  '{navn} nevnte deg · {båt}', 'Kaibok levert · {båt}', 'Kaibok levert · {båt} · avvik',
  'Du er satt opp som {rolle} · {båt} {når}',
  'Kaibok levert av {navn} · {hva} · {snitt} av 5. Anløpet er satt til Ferdig.', 'ingen avvik', 'avvik', 'avvik: {kategorier}',

  // AIS-status
  'Ingen båter i kaiboka har MMSI ennå.', 'Ingen gyldige MMSI blant båtene i kaiboka.', 'Ukjent feil mot BarentsWatch.',
  'BarentsWatch-nøkler mangler: {nøkler}. Legg dem inn som Secret under Settings → Variables and Secrets (ikke under Build).',
  'BarentsWatch-innlogging feilet ({kode}).', 'BarentsWatch-innlogging feilet ({kode}): {hvorfor}', 'BarentsWatch AIS svarte {kode}',
  'AIS er ikke satt opp.', 'Fikk ikke hentet AIS for kysten.', 'Fant ikke sporet.',

  // Feilmeldinger fra API-et
  'Agenten finnes allerede.', 'Anløpet er avlyst.', 'Anløpet er avsluttet; bilder kan ikke legges til.',
  'Anløpet er endret av noen andre. Last inn på nytt og prøv igjen.', 'Bare planlagte ordre kan startes.', 'Bare WebP eller JPEG er støttet.',
  'Bestillingen er allerede ferdig eller avlyst.', 'Bestillingen er allerede startet, ferdig eller avlyst.', 'Bestillingen lastes ikke nå.',
  'Bildet er for stort (maks 4 MB etter nedskalering).', 'Bildet finnes ikke i lageret.', 'Bildet hører til en levert kaibok og kan ikke slettes.',
  'Bildet mangler.', 'Brukeren er deaktivert.', 'Det finnes allerede en bruker med denne e-posten.',
  'Det finnes allerede en kai med dette navnet hos den bedriften.', 'Du har ikke tilgang til dette.', 'Du kan bare slette egne bilder.',
  'Du kan ikke fjerne din egen admin-tilgang eller deaktivere deg selv.', 'ETD må være etter ETA.', 'Fant ikke anløpet.', 'Fant ikke båten.',
  'Fant ikke bestillingen.', 'Fant ikke bildet.', 'Fant ikke brukeren.', 'Fant ikke kaia.', 'Fant ikke kaiboka.',
  'Fant ikke ordren, eller den er avlyst.', 'Fant ikke ordren.', 'Fant ikke pakkelinjen.', 'Ikke innlogget.', 'Ingen endringer.',
  'Ingen ordre pakkes på denne linjen – start en ordre før påfylling.', 'Ingen steg å gå videre fra.',
  'Kaibok er allerede levert for dette anløpet.', 'Kaibok er levert, og anløpet kan ikke endres.', 'Kunne ikke opprette bruker.',
  'Miniatyrbildet er for stort.', 'Miniatyrbildet må være WebP eller JPEG.', 'Navn og ansvarlig settes av produksjonen.',
  'Ordren er allerede ferdig eller avlyst.', 'Ordren finnes ikke eller er allerede hentet.', 'Ordren pakkes ikke nå.',
  'Samme person og rolle er oppgitt to ganger.', 'Ugyldig dato.', 'Ugyldig eller utløpt innlogging.', 'Ugyldige data.', 'Ukjent agent.',
  'Ukjent båt.', 'Ukjent bilde, eller bildet hører til et annet anløp.', 'Ukjent bildetype.', 'Ukjent eller deaktivert person.',
  'Ukjent kai.', 'Ukjent pakkelinje.', 'Ukjent person.', 'Ukjent produkt.', 'Ukjent saltkvalitet.', 'Ukjent vare.',
  'Noe gikk galt på serveren.', 'Fant ikke ressursen.', 'Ugyldig JSON.',
  '{epost} har ikke tilgang til Flow. Be en administrator legge deg til.', '{navn} er ikke registrert som {rolle}.',
  'Det finnes allerede en båt med samme {felt}.', 'Maks {n} bilder per båt. Slett noen gamle først.', 'Maks {n} bilder per kaibok.',
  'Skriv en kort begrunnelse.', 'Maks 92 dager per spørring.', 'Meldingen er tom.',
  'Velg minst én kategori eller skriv en beskrivelse av avviket.', 'Kategorier kan bare settes når det er avvik.',
  'Skriv en begrunnelse for overstyringen.', 'Skriv inn kunde.', 'Legg til minst én vare.', 'Skriv inn bil.', 'Legg til minst ett steg.',
  // Bulkutlevering: logg, rapportgrupper og feilmeldinger fra /api/bulk og /api/driver
  'Startet lasting', 'Steg ferdig – veid', 'Fortsatte lasting', 'Ferdig – følgeseddel laget',
  'Kvalitet', 'Kunde', 'Bil', 'Sjåfør', 'Transportør', 'Prosjekt', 'Dag',
  'Bilen er registrert uten henger.', 'Sett en PIN (4–6 siffer).', 'Skriv inn veid tonn.', 'Til-dato må være etter fra-dato.', 'Ukjent bil.', 'Ukjent kunde.',
  'Ukjent saltkvalitet.', 'Ukjent sjåfør.', 'Feil telefonnummer eller PIN.', 'Ikke innlogget.', 'Innloggingen har utløpt. Logg inn på nytt.',
  'Bilen hører til et annet transportfirma.', 'Fant ikke bestillingen.', 'Bestillingen er allerede ferdig eller avlyst.', 'Følgeseddel lages når lastingen er ferdig.',
  'Ingen steg lastes nå.', 'Lastingen er ikke stoppet.', 'Lastingen er startet. Kontakt kontoret.', 'Lastingen kan ikke startes nå.',
  'Nødstopp kan bare trykkes under lasting.', 'For mange forsøk. Prøv igjen om noen minutter.', '{kunde} krever prosjektnummer.',
  'Det finnes allerede et transportfirma med dette navnet.', 'Det finnes allerede en kunde med dette navnet.',
  'Det finnes allerede en sjåfør med dette telefonnummeret.', 'Det finnes allerede en bil med dette reg.nr.',
  'NØDSTOPP ved utlastingen: {bil} ({navn})', 'Egne biler',
  // Søk og «Spør Flow»
  'Ny bulklasting', 'Ny bilhenting', 'Ny salgsordre', 'Ny båt', 'Agent',
  'Spør Flow er ikke satt opp (ANTHROPIC_API_KEY mangler).', 'Nøkkelen til Claude (ANTHROPIC_API_KEY) er ugyldig.', 'Claude er opptatt akkurat nå. Prøv igjen om litt.',
  'Fikk ikke svar fra Claude.', 'Spørsmålet ble for omfattende. Prøv å spørre mer avgrenset.', 'Du har stilt mange spørsmål den siste timen. Prøv igjen litt senere.',
  // Claude: jobber, brief og kaibok
  'Fant ikke forslaget.', 'Jobben er allerede gjort.', 'Forslaget er ikke aktivt lenger.', 'Forslaget er for gammelt. Spør på nytt, så lager Flow et nytt.',
  'Claude klarte ikke å fylle ut kaiboka. Prøv å beskrive litt mer.', 'Gi nettleseren tilgang til mikrofonen.', 'Talegjenkjenningen stoppet.',
  'Fant ikke båten.', 'Velg en periode på maks ett år.',
  'Noe gikk galt.', 'Feil {kode}',
];
