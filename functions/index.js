// Splitwise proxy — Splitwise's OAuth token endpoint and REST API send no CORS
// headers, so the browser can't call them directly. This function runs those
// calls server-side. It's reached same-origin via a Firebase Hosting rewrite
// (/api/splitwise/** -> splitwiseProxy), so the SPA needs no CORS handling and
// the client secret never ships to the browser.
//
// Routes (path after /api/splitwise):
//   POST /token          body { code }         -> exchanges the auth code for an access token
//   GET  /api/<swPath>   Authorization: Bearer -> forwards to secure.splitwise.com/api/v3.0/<swPath>
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret, defineString } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');

// Public values (safe to ship): overridable via env, with the project defaults.
const CLIENT_ID = defineString('SPLITWISE_CLIENT_ID', {
  default: 'ArJ0dxQTlRhtq3dqp5T0G7eGXvcCzas2i2KNrat5'
});
const REDIRECT_URI = defineString('SPLITWISE_REDIRECT_URI', {
  default: 'https://two-cents-budget-tracker.web.app/#/splitwise/callback'
});
// Secret: set with `firebase functions:secrets:set SPLITWISE_CLIENT_SECRET`.
const CLIENT_SECRET = defineSecret('SPLITWISE_CLIENT_SECRET');

const TOKEN_URL = 'https://secure.splitwise.com/oauth/token';
const API_BASE = 'https://secure.splitwise.com/api/v3.0';
const MARKER = '/api/splitwise';

exports.splitwiseProxy = onRequest(
  { secrets: [CLIENT_SECRET], region: 'us-central1', cors: false },
  async (req, res) => {
    try {
      const markerIndex = req.path.indexOf(MARKER);
      const sub = markerIndex >= 0 ? req.path.slice(markerIndex + MARKER.length) : req.path;

      // ── Token exchange ──
      if (sub === '/token' || sub === '/token/') {
        if (req.method !== 'POST') {
          res.status(405).json({ error: 'method_not_allowed' });
          return;
        }
        const code = req.body && req.body.code;
        if (!code) {
          res.status(400).json({ error: 'missing_code' });
          return;
        }
        const params = new URLSearchParams({
          client_id: CLIENT_ID.value(),
          client_secret: CLIENT_SECRET.value(),
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI.value()
        });
        const upstream = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString()
        });
        const text = await upstream.text();
        res.status(upstream.status).type('application/json').send(text);
        return;
      }

      // ── Authenticated API passthrough ──
      if (sub.startsWith('/api/')) {
        const swPath = sub.slice('/api'.length); // e.g. /get_groups
        const queryIndex = req.originalUrl.indexOf('?');
        const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
        const target = API_BASE + swPath + query;
        const auth = req.get('Authorization') || '';
        if (!auth) {
          res.status(401).json({ error: 'missing_authorization' });
          return;
        }
        const upstream = await fetch(target, {
          method: req.method === 'POST' ? 'POST' : 'GET',
          headers: { Authorization: auth }
        });
        const text = await upstream.text();
        res.status(upstream.status).type('application/json').send(text);
        return;
      }

      res.status(404).json({ error: 'not_found', path: sub });
    } catch (err) {
      logger.error('splitwiseProxy error', err);
      res.status(502).json({ error: 'proxy_error' });
    }
  }
);
