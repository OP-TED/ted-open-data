/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or – as soon they will be approved by the European
 * Commission – subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */

/**
 * Build the SPARQL currency-conversion snippet inserted by the editor
 * autocomplete: an OPTIONAL VALUES lookup of currency→EUR rates plus a BIND
 * that converts an amount to EUR.
 *
 * The VALUES lookup is wrapped in OPTIONAL and the conversion BIND is left
 * OUTSIDE it, deliberately WITHOUT a COALESCE fallback:
 *  - A bare (non-optional) VALUES inner-joins with the result's ?currency and
 *    would silently DROP any row whose currency is absent from the table;
 *    OPTIONAL keeps those rows.
 *  - With no rate matched, ?rate stays unbound, so ?OriginalAmountValue * ?rate
 *    is unbound too — ?AmountValueInEUR is simply blank ("not convertible")
 *    rather than a fabricated 1:1 amount mislabelled as EUR that would corrupt
 *    sums/rankings.
 *  - The BIND MUST stay outside the OPTIONAL: SPARQL evaluates the OPTIONAL
 *    group independently and left-joins it, so a BIND inside it cannot see
 *    ?OriginalAmountValue (bound outside) and nothing would convert at all.
 *
 * @param {{ rates: Object<string, number> }} exchangeRates - parsed exchange-rates.json
 * @returns {string} the multi-line snippet text
 */
export function buildCurrencySnippet(exchangeRates) {
  const ratesEntries = Object.entries(exchangeRates.rates)
    .map(([currency, rate]) => `      ("${currency}" ${rate})`)
    .join('\n');

  return `# Sample exchange rate lookup table (rates to EUR).
# This option is provided to showcase how currencies can be converted to EUR within SPARQL.
# Use it only for approximate value calculations.
# The rate lookup is OPTIONAL: a currency missing from the table keeps its result row but leaves
# ?AmountValueInEUR unbound (blank) instead of a misleading 1:1 "EUR" value — add the currency
# below to convert it (or FILTER(BOUND(?AmountValueInEUR)) to keep only the converted rows).
# The query below lists every currency present in the dataset:
# PREFIX epo: <http://data.europa.eu/a4g/ontology#>
# PREFIX dc: <http://purl.org/dc/elements/1.1/>
# SELECT DISTINCT ?currency WHERE {
#   GRAPH ?g {
#     ?notice a epo:ResultNotice ;
#       epo:announcesNoticeAwardInformation / epo:hasTotalAwardedValue / epo:hasCurrency ?currencyURI .
#   }
#   ?currencyURI dc:identifier ?currency .
# } ORDER BY ?currency
  OPTIONAL {
    VALUES (?currency ?rate) {
${ratesEntries}
    }
  }
  BIND(?OriginalAmountValue * ?rate AS ?AmountValueInEUR)`;
}
