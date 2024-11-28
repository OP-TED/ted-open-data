/*
 * Copyright 2022 European Union
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

app.use(cors());
app.use(express.urlencoded({ extended: true }));

const proxyUrl = process.env.http_proxy || process.env.HTTP_PROXY;

app.all('/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('URL is required');
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
      rejectUnauthorized: false,
      secureOptions: require('constants').SSL_OP_NO_TLSv1_2
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

app.listen(port, () => {
  console.log(`CORS proxy server running at http://localhost:${port}`);
});
