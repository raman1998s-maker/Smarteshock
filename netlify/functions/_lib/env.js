// Lettura delle variabili d'ambiente (solo lato server, impostate su Netlify).
// Nessun valore di default: se manca qualcosa la function risponde 500
// "server_misconfigured" e nel log compare SOLO il nome della variabile.

export class ConfigError extends Error {
  constructor(name) {
    super(`Variabile d'ambiente mancante: ${name}`);
    this.name = 'ConfigError';
  }
}

const REQUIRED = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ALLOWED_ORIGIN'];

export function getEnv() {
  const env = {};
  for (const name of REQUIRED) {
    const value = (process.env[name] || '').trim();
    if (!value) throw new ConfigError(name);
    env[name] = value;
  }
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    throw new ConfigError('SUPABASE_URL (non valida)');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new ConfigError('SUPABASE_URL (deve essere https)');
  }
  return {
    supabaseUrl: url.origin,
    anonKey: env.SUPABASE_ANON_KEY,
    // Uno o più origin separati da virgola, es. "https://meekondisplay.ch,https://www.meekondisplay.ch"
    allowedOrigins: env.ALLOWED_ORIGIN.split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
  };
}
