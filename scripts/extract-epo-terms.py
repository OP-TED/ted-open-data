#!/usr/bin/env python3
# Copyright 2026 European Union
#
# Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
# Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
# compliance with the Licence. You may obtain a copy of the Licence at:
# https://joinup.ec.europa.eu/software/page/eupl
#
# Unless required by applicable law or agreed to in writing, software distributed under the Licence
# is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
# or implied. See the Licence for the specific language governing permissions and limitations under
# the Lic

"""
Extract ePO ontology terms from an OWL TTL file and save as JSON
for use by the SPARQL editor autocomplete.

Usage:
    python3 scripts/extract-epo-terms.py <path-to-epo-core.ttl> <version> <output-file>

Example:
    python3 scripts/extract-epo-terms.py \
        ../ePO/implementation/ePO_core/owl_ontology/ePO_core.ttl \
        4.2.0 \
        src/assets/epo-terms-v4.json
"""

import re
import json
import sys

COMMON_PREFIXES = {
    "epo": "http://data.europa.eu/a4g/ontology#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "skos": "http://www.w3.org/2004/02/skos/core#",
    "adms": "http://www.w3.org/ns/adms#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "m8g": "http://data.europa.eu/m8g/",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "dcterms": "http://purl.org/dc/terms/",
    "org": "http://www.w3.org/ns/org#",
    "cdm": "http://publications.europa.eu/ontology/cdm#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "owl": "http://www.w3.org/2002/07/owl#",
    "foaf": "http://xmlns.com/foaf/0.1/",
}

SPARQL_KEYWORDS = [
    "SELECT", "CONSTRUCT", "DESCRIBE", "ASK",
    "WHERE", "FILTER", "OPTIONAL", "UNION", "MINUS",
    "GRAPH", "SERVICE", "BIND", "VALUES",
    "GROUP BY", "ORDER BY", "HAVING", "LIMIT", "OFFSET",
    "DISTINCT", "REDUCED", "AS", "FROM", "NAMED",
    "PREFIX", "BASE",
    "COUNT", "SUM", "MIN", "MAX", "AVG", "SAMPLE", "GROUP_CONCAT",
    "BOUND", "IF", "COALESCE", "EXISTS", "NOT EXISTS",
    "STR", "LANG", "LANGMATCHES", "DATATYPE", "IRI", "URI",
    "STRSTARTS", "STRENDS", "CONTAINS", "STRLEN", "SUBSTR", "REPLACE",
    "UCASE", "LCASE", "CONCAT", "REGEX",
    "YEAR", "MONTH", "DAY", "HOURS", "MINUTES", "SECONDS",
    "NOW", "RAND", "ABS", "CEIL", "FLOOR", "ROUND",
    "ASC", "DESC", "true", "false", "IN", "NOT IN", "a",
]


def extract_terms(ttl_content, version):
    # Match common ePO TTL prefixes: a4g:Name, epo:Name, or :Name (default)
    classes = sorted(set(re.findall(r"(?:a4g|epo|):(\w+)\s+a\s+owl:Class", ttl_content)))
    object_props = sorted(set(re.findall(r"(?:a4g|epo|):(\w+)\s+a\s+owl:ObjectProperty", ttl_content)))
    datatype_props = sorted(set(re.findall(r"(?:a4g|epo|):(\w+)\s+a\s+owl:DatatypeProperty", ttl_content)))

    return {
        "version": version,
        "namespace": "http://data.europa.eu/a4g/ontology#",
        "prefix": "epo",
        "classes": classes,
        "objectProperties": object_props,
        "datatypeProperties": datatype_props,
        "prefixes": COMMON_PREFIXES,
        "keywords": SPARQL_KEYWORDS,
    }


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    ttl_path, version, output_path = sys.argv[1], sys.argv[2], sys.argv[3]

    with open(ttl_path, "r") as f:
        content = f.read()

    data = extract_terms(content, version)

    with open(output_path, "w") as f:
        json.dump(data, f, indent=2)

    print(f"ePO {version}: {len(data['classes'])} classes, "
          f"{len(data['objectProperties'])} object properties, "
          f"{len(data['datatypeProperties'])} datatype properties "
          f"-> {output_path}")
