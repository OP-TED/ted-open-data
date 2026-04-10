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
// Copy a string to the system clipboard. Tries the async Clipboard API
// first; falls back to a hidden input + execCommand for browsers that
// block clipboard access (older Safari, insecure contexts). Returns
// whether the copy actually succeeded so callers can flash a confirm
// or an error icon — silently failing leaves users pasting stale data
// thinking the share worked.
export async function copyToClipboard(text) {
  try {
    if (!navigator.clipboard) {
      return _fallbackCopy(text);
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Leave a breadcrumb so a developer watching "clipboard is
    // silently failing in browser X" has something to start from.
    // The return value (false) still lets the caller surface a
    // user-facing error.
    console.warn('[clipboard] navigator.clipboard.writeText failed, trying fallback:', err);
    return _fallbackCopy(text);
  }
}

function _fallbackCopy(text) {
  const input = document.createElement('textarea');
  input.value = text;
  input.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(input);
  input.select();
  let success = false;
  try {
    success = document.execCommand('copy');
  } catch (err) {
    console.warn('[clipboard] execCommand("copy") fallback failed:', err);
    success = false;
  }
  document.body.removeChild(input);
  return success;
}
