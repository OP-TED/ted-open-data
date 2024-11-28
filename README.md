# TED SPARQL Editor

A web-based SPARQL query editor for exploring TED Open Data. This application allows users to write and execute SPARQL queries against the RDF database of the Publications Office (Cellar), view and download query results in multiple formats, and reuse queries in their applications via query URLs.

## Features

- Interactive SPARQL query editor
- Multiple result formats (JSON, HTML, XML, CSV, etc.)
- Direct downloads
- Reusable query URLs

## Live Version

Visit [TED SPARQL Editor](https://docs.ted.europa.eu/ted-sparql-editor) to use the live version of the application.

## Development Setup

### Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)

### Installation & Running

1. Clone the repository:
   ```bash
   git clone https://github.com/OP-TED/ted-sparql-editor.git
   cd ted-sparql-editor
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the CORS proxy:
   ```bash
   npm start
   # or directly:
   node src/js/cors-proxy.js
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

### Corporate Proxy Configuration

If you're behind a corporate proxy:

1. Set the proxy environment variables before starting the CORS proxy:
   ```bash
   # Windows
   set HTTP_PROXY=http://your.proxy.com:8080
   set HTTPS_PROXY=http://your.proxy.com:8080

   # Linux/Mac
   export HTTP_PROXY=http://your.proxy.com:8080
   export HTTPS_PROXY=http://your.proxy.com:8080
   ```

2. Or add them to your system environment variables permanently

### Environment Configuration

The application supports two environments:
- Production: Uses the live Cellar endpoint (production server)
- Test: Uses the Cellar endpoint dedicated for testing. 
  Caution: The test endpoint only contains a sample data.

The endpoints are configured in `config.json`:
