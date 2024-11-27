const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const port = 8080;

app.use(cors());

app.get('/proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) {
    return res.status(400).send('URL is required');
  }
  try {
    const response = await fetch(url);
    const body = await response.text();
    res.send(body);
  } catch (error) {
    res.status(500).send(`Error fetching URL: ${error.message}`);
  }
});

app.listen(port, () => {
  console.log(`CORS proxy server running at http://localhost:${port}`);
});
