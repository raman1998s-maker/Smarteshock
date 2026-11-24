// GET /api/me — profilo dell'utente connesso.
import { createHandler } from './_lib/handler.js';
import { json } from './_lib/http.js';

export const config = { path: '/api/me' };

export default createHandler(
  {
    GET: {
      auth: 'user',
      fn: ({ user }) => json(200, { id: user.id, nome: user.nome, ruolo: user.ruolo }),
    },
  },
  { pattern: /^\/api\/me\/?$/ },
);
