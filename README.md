# TED Open Data Service[^1]

A web-based tool for exploring TED Open Data — the public procurement data published by the Publications Office of the EU as Linked Open Data. The app combines two complementary workflows over the same RDF backend:

- **Look up an individual notice** by its publication number and inspect its full RDF graph as a navigable tree, raw Turtle, or backlinks view. Procedure timeline, breadcrumb navigation, drill-into-resource, and shareable URLs included.
- **Write SPARQL queries** against the entire dataset using a CodeMirror 6 editor with ePO-aware autocomplete and syntax linting. SELECT and ASK results render as a table; CONSTRUCT and DESCRIBE results render as the same RDF graph view used by notice lookup.

The two workflows share a single **Reuse** tab that auto-picks the right rendering based on the query type (tabular for SELECT/ASK, graph for CONSTRUCT/DESCRIBE).

## Features

- **Notice browser**: type a publication number → navigate the resulting RDF graph
- **Procedure timeline**: see all sibling notices in the same procurement procedure with one click
- **SPARQL editor** with ePO autocomplete, syntax linting, and a curated query library
- **Auto-routing by query type**: SELECT/ASK → tabular results, CONSTRUCT/DESCRIBE → tree/turtle/backlinks
- **Shareable URLs** for any notice or sub-resource view (`?facet=…`)
- **Multiple result formats** for SELECT (JSON, HTML, XML, CSV, TSV, Spreadsheet) and graph downloads (Turtle, RDF/XML, N-Triples)
- **Reusable query URLs** for embedding into Excel, Power BI, etc.

## Live Version

Visit [TED Open Data](https://data.ted.europa.eu/) to use the live version of the application.

## Development Setup

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation & Running

1. Clone the repository:
    ```bash
    git clone https://github.com/OP-TED/ted-open-data.git
    cd ted-open-data
    ```

2. Install dependencies:
    ```bash
    npm install
    ```

3. Start the CORS proxy:
    ```bash
    npm start
    # or directly:
    node src/js/cors-proxy.cjs
    ```

4. Open the application:
    - Simply open the `index.html` file in your browser
    - The application will use the CORS proxy running on `http://localhost:8080` for all SPARQL queries

### Local Development Setup

The application consists of:
1. A static web interface (index.html and associated files)
2. A CORS proxy server for handling SPARQL queries

To run the application locally:
1. Start the CORS proxy using `npm start`
2. Open `index.html` in your web browser
3. That's it! No additional web server is needed

### Updating CodeMirror

The editors use a self-hosted CodeMirror v6 bundle (`src/vendor/codemirror-bundle.js`) to avoid CDN version drift issues. The bundle exports the SPARQL language (used by the Query Editor) and the Turtle language (used by the notice browser's Turtle view). This bundle only needs to be rebuilt when updating CodeMirror versions:

1. Update the versions in `package.json` under `devDependencies`
2. Run `npm install`
3. Run `npm run build:codemirror`
4. Commit the updated bundle

### Simulating Server Errors

The CORS proxy supports a `SIMULATE` environment variable that forces every `/proxy` and `/sparql` request to return a canned failure. This is useful for evaluating the friendly error states in the app without needing to craft a broken query or wait for an endpoint outage.

```bash
# Virtuoso-shaped 400 parser error
SIMULATE=400 npm start

# Virtuoso-shaped 500 internal error
SIMULATE=500 npm start

# 504 Gateway Timeout
SIMULATE=504 npm start

# Network failure (connection reset)
SIMULATE=network npm start
```

Any other value is ignored and the proxy behaves normally. The active simulation mode is logged at startup.

### Corporate Proxy Configuration

If you're behind a corporate proxy:

1. Set the proxy environment variables before starting the CORS proxy:
    ```bash
    # Windows
    set HTTP_PROXY=http://username:password@your.proxy.host:port
    set HTTPS_PROXY=http://username:password@your.proxy.host:port

    # Linux/Mac
    export HTTP_PROXY=http://username:password@your.proxy.host:port
    export HTTPS_PROXY=http://username:password@your.proxy.host:port
    ```

2. Or add them to your system environment variables permanently

### Environment Configuration

The application supports two environments:
- Production: Uses the live Cellar endpoint (production server)
- Test: Uses the Cellar endpoint dedicated for testing. 
  Caution: The test endpoint only contains sample data.

The endpoints are configured in `config.json`

## Third-Party Components

This project uses the following third-party components:

### Application
- **Bootstrap** (v5.3.8)
  - Purpose: CSS framework for styling and components
  - License: MIT
  - Website: https://getbootstrap.com/

- **Bootstrap Icons** (v1.11.3)
  - Purpose: Icon library
  - License: MIT
  - Website: https://icons.getbootstrap.com/

- **CodeMirror** (v6)
  - Purpose: Code editor
  - License: MIT
  - Website: https://codemirror.net/

- **codemirror-lang-sparql** (v2.0.0)
  - Purpose: SPARQL syntax highlighting for CodeMirror
  - License: MIT
  - Website: https://github.com/aatauil/codemirror-lang-sparql

- **codemirror-lang-turtle** (v0.0.2)
  - Purpose: Turtle syntax highlighting for CodeMirror (used by the notice browser's Turtle view)
  - License: MIT
  - Website: https://github.com/grantjenks/codemirror-lang-turtle

- **sparqljs** (v3.7.4)
  - Purpose: SPARQL query parser and generator
  - License: MIT
  - Website: https://github.com/RubenVerborgh/SPARQL.js

- **N3.js** (v1.23.1)
  - Purpose: RDF / Turtle parser used by the notice browser to parse CONSTRUCT/DESCRIBE results into quads
  - License: MIT
  - Website: https://github.com/rdfjs/N3.js

- **Zod** (v4)
  - Purpose: Runtime validation for shareable URL parameters (`?facet=…`)
  - License: MIT
  - Website: https://zod.dev/

- **js-yaml** (v4.1.0)
  - Purpose: YAML parser and dumper
  - License: MIT
  - Website: https://github.com/nodeca/js-yaml

### Development Tools
- **Express** (v4.17.1)
  - Purpose: Local CORS proxy server
  - License: MIT
  - Website: https://expressjs.com/

- **cors** (v2.8.5)
  - Purpose: CORS middleware for Express
  - License: MIT
  - Website: https://github.com/expressjs/cors

- **node-fetch** (v2.6.1)
  - Purpose: Fetch API for Node.js
  - License: MIT
  - Website: https://github.com/node-fetch/node-fetch

- **https-proxy-agent** (v7.0.5)
  - Purpose: Corporate proxy support
  - License: MIT
  - Website: https://github.com/TooTallNate/node-https-proxy-agent

All third-party components are used under their respective licenses.

[^1]: _Copyright 2024 European Union_  
_Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European Commission – subsequent versions of the EUPL (the "Licence");_
_You may not use this work except in compliance with the Licence. You may obtain [a copy of the Licence here](LICENSE)._  
_Unless required by applicable law or agreed to in writing, software distributed under the Licence is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the Licence for the specific language governing permissions and limitations under the Licence._
