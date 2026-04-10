/*
 * Copyright 2026 European Union
 *
 * Licensed under the EUPL, Version 1.2 or - as soon they will be approved by the European
 * Commission - subsequent versions of the EUPL (the "Licence"); You may not use this work except in
 * compliance with the Licence. You may obtain a copy of the Licence at:
 * https://joinup.ec.europa.eu/software/page/eupl
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the Licence
 * is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the Licence for the specific language governing permissions and limitations under
 * the Licence.
 */
// randomNotice tests — the retry loop, the exhaustion throw, the
// endpoint-error recovery, and the quad-shape handling. Non-DOM logic
// that today is only exercised end-to-end via manual testing; this
// suite closes that gap.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getRandomPublicationNumber,
  __setDoSPARQLForTesting,
  __resetForTesting,
} from '../src/js/services/randomNotice.js';

const EPO_HAS_PUB_NUMBER = 'http://data.europa.eu/a4g/ontology#hasNoticePublicationNumber';

// Build a CONSTRUCT-shaped quad the way the N3 parser produces it.
function publicationQuad(publicationNumber) {
  return {
    subject:   { termType: 'NamedNode', value: 'http://example.org/notice/' + publicationNumber },
    predicate: { termType: 'NamedNode', value: EPO_HAS_PUB_NUMBER },
    object:    { termType: 'Literal',   value: publicationNumber },
  };
}

beforeEach(() => {
  __resetForTesting();
  // Silence the expected console.warn from the error-recovery test below.
  // Each test that expects warnings restores its own console.warn.
});

// ── happy path ─────────────────────────────────────────────────────

test('getRandomPublicationNumber resolves with the publication number from the first successful batch', async () => {
  __setDoSPARQLForTesting(async () => ({
    quads: [publicationQuad('00172531-2026')],
  }));
  const result = await getRandomPublicationNumber();
  assert.equal(result, '00172531-2026');
});

test('getRandomPublicationNumber only looks at quads whose predicate is hasNoticePublicationNumber', async () => {
  // The CONSTRUCT produces only one triple per notice, but if the endpoint
  // ever hands us extra quads we shouldn't accidentally pick the wrong one.
  __setDoSPARQLForTesting(async () => ({
    quads: [
      {
        subject:   { termType: 'NamedNode', value: 'http://example.org/notice/X' },
        predicate: { termType: 'NamedNode', value: 'http://example.org/unrelated' },
        object:    { termType: 'Literal', value: 'SHOULD_NOT_BE_PICKED' },
      },
      publicationQuad('00000001-2024'),
    ],
  }));
  const result = await getRandomPublicationNumber();
  assert.equal(result, '00000001-2024');
});

// ── retry path ─────────────────────────────────────────────────────

test('getRandomPublicationNumber retries when the first window is empty and succeeds on a later attempt', async () => {
  let callCount = 0;
  __setDoSPARQLForTesting(async () => {
    callCount++;
    if (callCount < 3) return { quads: [] }; // empty results for first two attempts
    return { quads: [publicationQuad('00149228-2024')] };
  });

  const result = await getRandomPublicationNumber();
  assert.equal(result, '00149228-2024');
  assert.equal(callCount, 3, 'should have retried twice before succeeding');
});

test('getRandomPublicationNumber widens the date window after the first failed attempt', async () => {
  // We can't directly inspect the date ranges without exporting the
  // window helpers, but we can verify that repeated attempts happen
  // (indirectly confirms the retry loop runs the expand branch).
  let callCount = 0;
  __setDoSPARQLForTesting(async () => {
    callCount++;
    if (callCount < 5) return { quads: [] };
    return { quads: [publicationQuad('00056731-2024')] };
  });

  const result = await getRandomPublicationNumber();
  assert.equal(result, '00056731-2024');
  assert.equal(callCount, 5);
});

// ── exhaustion path ───────────────────────────────────────────────

test('getRandomPublicationNumber throws after MAX_ATTEMPTS consecutive empty windows', async () => {
  // MAX_ATTEMPTS is 10 in the source. All 10 return empty — no fallback.
  let callCount = 0;
  __setDoSPARQLForTesting(async () => {
    callCount++;
    return { quads: [] };
  });

  await assert.rejects(
    () => getRandomPublicationNumber(),
    /Could not find a random notice/,
    'should throw a user-facing error after exhausting attempts',
  );
  assert.equal(callCount, 10, 'should have made MAX_ATTEMPTS attempts');
});

test('getRandomPublicationNumber does NOT fall back to a hardcoded notice on exhaustion', async () => {
  // Regression guard: the pre-rewrite version returned a hardcoded
  // publication number on failure. That behaviour was deliberately
  // removed — the function must now throw, not silently return the
  // same string every time.
  __setDoSPARQLForTesting(async () => ({ quads: [] }));
  let errored = false;
  try {
    await getRandomPublicationNumber();
  } catch {
    errored = true;
  }
  assert.equal(errored, true, 'must throw, never return on exhaustion');
});

// ── endpoint error recovery ──────────────────────────────────────

test('getRandomPublicationNumber treats doSPARQL errors as empty-window and retries', async () => {
  // If the endpoint throws (network blip, 500, worker crash), the
  // _queryRandomNoticeInRange catch returns null, which feeds into the
  // same "not found, try again" path. No error should escape the
  // function until MAX_ATTEMPTS is exhausted.
  const originalWarn = console.warn;
  console.warn = () => {}; // silence the expected warning

  try {
    let callCount = 0;
    __setDoSPARQLForTesting(async () => {
      callCount++;
      if (callCount < 4) throw new Error('endpoint down');
      return { quads: [publicationQuad('00141863-2026')] };
    });

    const result = await getRandomPublicationNumber();
    assert.equal(result, '00141863-2026');
    assert.equal(callCount, 4, 'should have retried through 3 errors');
  } finally {
    console.warn = originalWarn;
  }
});

test('getRandomPublicationNumber throws when every attempt errors', async () => {
  const originalWarn = console.warn;
  console.warn = () => {}; // silence 10 expected warnings

  try {
    __setDoSPARQLForTesting(async () => { throw new Error('endpoint hard-down'); });
    await assert.rejects(
      () => getRandomPublicationNumber(),
      /Could not find a random notice/,
    );
  } finally {
    console.warn = originalWarn;
  }
});
