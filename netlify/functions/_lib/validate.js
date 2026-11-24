// Validazione degli input: tipi, lunghezze, enum. Ogni errore diventa
// 400 { error: "invalid_input", field: "<nome campo>" } (mai il valore).

import { HttpError } from './http.js';

const MISSING = Symbol('missing');

function fail(field) {
  const safe = typeof field === 'string' && /^[a-z_]{1,40}$/.test(field) ? field : undefined;
  return new HttpError(400, 'invalid_input', safe ? { field: safe } : undefined);
}

// Caratteri di controllo non ammessi (tranne tab, a capo).
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function isEmpty(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function wrap(spec, check) {
  // spec.required: obbligatorio alla creazione; valori vuoti → null (se non obbligatorio)
  const fn = (value, field) => {
    if (isEmpty(value)) {
      if (spec.required) throw fail(field);
      return spec.empty !== undefined ? spec.empty : null;
    }
    return check(value, field);
  };
  fn.required = !!spec.required;
  fn.default = spec.default;
  return fn;
}

export const t = {
  string: ({ max, min = 1, multiline = false, pattern, ...spec } = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string') throw fail(f);
      const s = v.trim();
      if (s.length < min || s.length > max) throw fail(f);
      if (CONTROL_RE.test(s) || (!multiline && /[\r\n]/.test(s))) throw fail(f);
      if (pattern && !pattern.test(s)) throw fail(f);
      return s;
    }),

  email: (spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string') throw fail(f);
      const s = v.trim();
      if (s.length > 254 || !/^[^\s@<>()[\],;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(s)) {
        throw fail(f);
      }
      return s;
    }),

  phone: (spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string') throw fail(f);
      const s = v.trim();
      if (s.length > 40 || !/^\+?[0-9 ()./-]{3,40}$/.test(s)) throw fail(f);
      return s;
    }),

  int: ({ min, max, ...spec } = {}) =>
    wrap(spec, (v, f) => {
      const n = typeof v === 'string' && /^-?\d{1,9}$/.test(v.trim()) ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw fail(f);
      return n;
    }),

  money: ({ max = 10_000_000, ...spec } = {}) =>
    wrap(spec, (v, f) => {
      const n = typeof v === 'string' && /^\d{1,8}(\.\d{1,2})?$/.test(v.trim()) ? Number(v) : v;
      if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) throw fail(f);
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) throw fail(f);
      return Math.round(n * 100) / 100;
    }),

  bool: (spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'boolean') throw fail(f);
      return v;
    }),

  enumOf: (values, spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string' || !values.includes(v)) throw fail(f);
      return v;
    }),

  uuid: (spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) throw fail(f);
      return v.toLowerCase();
    }),

  /** Data "AAAA-MM-GG" valida. */
  date: (spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string' || !isValidDate(v.trim())) throw fail(f);
      return v.trim();
    }),

  /** Data e ora locali "AAAA-MM-GG" oppure "AAAA-MM-GGTHH:MM[:SS]" (senza fuso orario). */
  datetime: (spec = {}) =>
    wrap(spec, (v, f) => {
      if (typeof v !== 'string') throw fail(f);
      const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(v.trim());
      if (!m || !isValidDate(m[1])) throw fail(f);
      const [hh, mm, ss] = [m[2] ?? '00', m[3] ?? '00', m[4] ?? '00'].map(Number);
      if (hh > 23 || mm > 59 || ss > 59) throw fail(f);
      return `${m[1]}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    }),

  array: (item, { max, ...spec } = {}) =>
    wrap({ empty: [], ...spec }, (v, f) => {
      const arr = typeof v === 'string' ? [v] : v;
      if (!Array.isArray(arr) || arr.length > max) throw fail(f);
      const out = [];
      for (const x of arr) {
        const val = item(x, f);
        if (val !== null && !out.includes(val)) out.push(val);
      }
      return out;
    }),
};

export function isValidDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 2000 || y > 2100) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Valida un oggetto secondo uno schema { campo: validatore }.
 * @param {object} input
 * @param {object} schema
 * @param {{ partial?: boolean, ignore?: string[] }} [opts]
 *   partial: modifica (PATCH) — i campi mancanti restano invariati, ne serve almeno uno.
 *   ignore: chiavi tollerate ma scartate (es. "bot-field").
 */
export function validate(input, schema, { partial = false, ignore = [] } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail();
  for (const key of Object.keys(input)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key) && !ignore.includes(key)) throw fail(key);
  }
  const out = {};
  for (const [key, check] of Object.entries(schema)) {
    const has = Object.prototype.hasOwnProperty.call(input, key);
    const value = has ? input[key] : MISSING;
    if (value === MISSING) {
      if (partial) continue;
      if (check.required) throw fail(key);
      if (check.default !== undefined) out[key] = check.default;
      continue;
    }
    out[key] = check(value, key);
  }
  if (partial && Object.keys(out).length === 0) throw fail();
  return out;
}
