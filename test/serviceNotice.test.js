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
// Service notice tests — what notice.json must contain for the banner to show.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceNotice } from '../src/js/utils/serviceNotice.js';

test('shows the message when show is true', () => {
  assert.deepEqual(
    parseServiceNotice({ show: true, level: 'info', message: ' Planned maintenance. ' }),
    { level: 'info', message: 'Planned maintenance.' });
});

test('defaults to the warning level when the level is missing or unknown', () => {
  assert.equal(parseServiceNotice({ show: true, message: 'x' }).level, 'warning');
  assert.equal(parseServiceNotice({ show: true, level: 'danger', message: 'x' }).level, 'warning');
});

test('shows nothing unless show is exactly true', () => {
  for (const show of [false, 'true', 1, undefined]) {
    assert.equal(parseServiceNotice({ show, message: 'x' }), null);
  }
});

test('shows nothing without a message', () => {
  assert.equal(parseServiceNotice({ show: true }), null);
  assert.equal(parseServiceNotice({ show: true, message: '   ' }), null);
  assert.equal(parseServiceNotice({ show: true, message: 42 }), null);
});

test('shows nothing for content that is not an object', () => {
  for (const data of [null, undefined, 'show', [], 7]) {
    assert.equal(parseServiceNotice(data), null);
  }
});
