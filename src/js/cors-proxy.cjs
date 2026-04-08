/*
 * Copyright 2024 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Lic
 */

const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const { HttpsProxyAgent } = require('https-proxy-agent');
const https = require('https');

// Disable SSL verification for development
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const port = 8080;

// ── SSRF allowlist for /proxy ──
// /proxy?url=… accepts an arbitrary URL to fetch. Without an allowlist
// this is an open relay: any page the dev visits can force the proxy
// (which has network access the browser does not, including corporate
// intranet via HTTP_PROXY) to fetch arbitrary URLs via a simple
// cross-origin form POST or DNS rebinding. The allowlist restricts
// target hostnames to the TED SPARQL endpoint and a handful of
// documentation/raw-content hosts actually used by the app.
const PROXY_HOST_ALLOWLIST = new Set([
  'publications.europa.eu',
  'data.europa.eu',
]);

function isAllowedProxyTarget(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    return PROXY_HOST_ALLOWLIST.has(parsed.hostname);
  } catch {
    return false;
  }
}

app.use(cors());
app.use(express.urlencoded({ extended: true }));

const proxyUrl = process.env.http_proxy || process.env.HTTP_PROXY;

// ── Dev error simulation ──
// Start the proxy with SIMULATE=<kind> to force every /proxy and
// /sparql request to fail in a canned way, so the friendly error
// states on the Data tab can be evaluated without needing to break
// a real query. Supported kinds:
//   400      → Virtuoso-shaped parser error
//   500      → Virtuoso-shaped internal error
//   504      → Gateway timeout
//   network  → connection reset (socket destroyed)
// Any other value is ignored. When SIMULATE is unset the proxy
// behaves normally.
const SIMULATE = process.env.SIMULATE;
if (SIMULATE) {
  console.log(`[dev] SIMULATE=${SIMULATE} — all /proxy and /sparql requests will return canned failures`);
}

function applySimulation(req, res) {
  if (!SIMULATE) return false;
  if (SIMULATE === '400') {
    res.status(400).set('Content-Type', 'text/plain').send(
      "Virtuoso 37000 Error SP030: SPARQL compiler, line 1: syntax error at 'BROKEN' before 'WHERE'"
    );
    return true;
  }
  if (SIMULATE === '500') {
    res.status(500).set('Content-Type', 'text/plain').send(
      'Virtuoso 42000 Error The query was killed'
    );
    return true;
  }
  if (SIMULATE === '504') {
    res.status(504).set('Content-Type', 'text/plain').send('Gateway Timeout');
    return true;
  }
  if (SIMULATE === 'network') {
    // Close the socket without a response — the browser sees a
    // "Failed to fetch" TypeError from the fetch API.
    req.socket.destroy();
    return true;
  }
  return false;
}

app.all('/proxy', async (req, res) => {
  if (applySimulation(req, res)) return;
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL is required');
  }
  if (!isAllowedProxyTarget(targetUrl)) {
    console.warn(`[proxy] rejected non-allowlisted target: ${targetUrl}`);
    return res.status(403).send('Target host is not on the proxy allowlist.');
  }

  console.log(`Proxying request to: ${targetUrl}`);
  if (proxyUrl) {
    console.log(`Using corporate proxy: ${proxyUrl}`);
  }

  // Clean up headers
  const cleanHeaders = {
    'Accept': req.headers['accept'] || 'application/sparql-results+json',
    'Content-Type': 'application/x-www-form-urlencoded',
  };

  const options = {
    method: req.method,
    headers: cleanHeaders,
    body: req.method === 'POST' ? new URLSearchParams(req.body).toString() : undefined,
  };

  if (proxyUrl) {
    const proxyAgent = new HttpsProxyAgent(proxyUrl);
    proxyAgent.rejectUnauthorized = false;
    options.agent = proxyAgent;
  } else {
    options.agent = new https.Agent({
      rejectUnauthorized: false
    });
  }

  try {
    const response = await fetch(targetUrl, options);
    console.log(`Response status: ${response.status}`);
    if (!response.ok) {
      console.error(`Error fetching URL: ${response.statusText}`);
      return res.status(response.status).send(`Error fetching URL: ${response.statusText}`);
    }
    const contentType = response.headers.get('content-type');
    res.setHeader('Content-Type', contentType);
    const body = await response.text();
    res.send(body);
  } catch (error) {
    console.error(`Error fetching URL: ${error.message}`);
    res.status(500).send(`Error fetching URL: ${error.message}`);
  }
});

// /sparql route — added by Stage 6 of the explorer integration so the
// ported sparqlService.js can hit a same-origin URL in dev. Forwards
// the request body verbatim to the real SPARQL endpoint and proxies
// the response back, preserving the Accept header (Turtle for
// CONSTRUCT/DESCRIBE, sparql-results+json for SELECT). The existing
// /proxy?url=... route above is unchanged and continues to serve the
// ted-open-data Query Editor's SELECT path.
const SPARQL_ENDPOINT = 'https://publications.europa.eu/webapi/rdf/sparql';
app.all('/sparql', async (req, res) => {
  if (applySimulation(req, res)) return;
  try {
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': req.headers.accept || 'text/turtle',
    };
    const body = req.method === 'POST'
      ? new URLSearchParams(req.body).toString()
      : undefined;
    const url = req.method === 'GET'
      ? `${SPARQL_ENDPOINT}?${new URLSearchParams(req.query)}`
      : SPARQL_ENDPOINT;
    const response = await fetch(url, {
      method: req.method === 'GET' ? 'GET' : 'POST',
      headers,
      body,
    });
    const text = await response.text();
    res.set('Content-Type', response.headers.get('Content-Type') || 'text/turtle');
    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

// Serve static files from the project root
app.use(express.static('.'));

app.listen(port, () => {
  console.log(`CORS proxy server running at http://localhost:${port}`);
});
