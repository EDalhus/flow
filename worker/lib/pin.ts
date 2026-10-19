// PIN for sjåfører: PBKDF2 (SHA-256) med tilfeldig salt. Tokens for innlogging lagres bare som SHA-256-hash.

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map(h => parseInt(h, 16)));

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  return { hash: hex(bits), salt: hex(salt) };
}

export async function verifyPin(pin: string, hash: string, salt: string): Promise<boolean> {
  const got = (await hashPin(pin, salt)).hash;
  // Sammenligning i konstant tid.
  let diff = got.length ^ hash.length;
  for (let i = 0; i < Math.min(got.length, hash.length); i++) diff |= got.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
