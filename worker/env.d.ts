// Valgfrie variabler som ikke står i wrangler.jsonc.
interface __FlowOptionalEnv {
  /** Kun lokal utvikling (.dev.vars): later som denne e-posten er innlogget når ACCESS_AUD er tom. */
  DEV_USER_EMAIL?: string;
  /** Cloudflare Access: teamdomene (f.eks. "firma.cloudflareaccess.com") og applikasjonens AUD-tag. Settes i dashbordet. */
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Kommaseparerte e-poster som blir admin ved første innlogging. Settes i dashbordet. */
  ADMIN_EMAILS?: string;
  /** BarentsWatch AIS – Cloudflare-secrets, settes i dashbordet eller med `wrangler secret put`. */
  BW_CLIENT_ID?: string;
  BW_CLIENT_SECRET?: string;
  /** «Spør Flow» (Claude): API-nøkkel som Cloudflare-secret, og valgfri modell (standard claude-sonnet-5-5). */
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
}
interface Env extends __FlowOptionalEnv {}
declare namespace Cloudflare {
  interface Env extends __FlowOptionalEnv {}
}
