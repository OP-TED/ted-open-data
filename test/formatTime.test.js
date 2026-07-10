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
// formatElapsedTime tests — ensures the execution time display
// formats correctly for both short and long-running queries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatElapsedTime } from '../src/js/utils/formatTime.js';

test('formats under 60 seconds as Xs', () => {
  assert.equal(formatElapsedTime('3.2'), '3.2s');
});

test('formats a fractional second value correctly', () => {
  assert.equal(formatElapsedTime('0.5'), '0.5s');
});

test('formats exactly 60 seconds as 1m 0s', () => {
  assert.equal(formatElapsedTime('60.0'), '1m 0s');
});

test('formats 60+ seconds as Mm Ss', () => {
  assert.equal(formatElapsedTime('125.7'), '2m 6s');
});

test('formats a large value correctly', () => {
  assert.equal(formatElapsedTime('3661.0'), '61m 1s');
});

test('handles numeric input as well as string input', () => {
  assert.equal(formatElapsedTime(45.3), '45.3s');
  assert.equal(formatElapsedTime(90), '1m 30s');
});
