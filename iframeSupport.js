/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const path = require('path');

/**
 * Patches the MCP Tab to resolve element refs that are inside iframes.
 * Snapshot refs for iframe content use the format f<frameIndex>e<elementId> (e.g. f1e2).
 * If the default page.locator('aria-ref=...') fails, we try each frame so that
 * iframe elements (including those identified by data-testid / data-componentid in the snapshot)
 * can be found and actions (click, type, etc.) work correctly.
 */
function applyIframeSupport() {
  if (applyIframeSupport._applied) return;
  applyIframeSupport._applied = true;

  // Tab is not in playwright's package exports; load via filesystem path
  const playwrightRoot = path.dirname(require.resolve('playwright/package.json'));
  const tabPath = path.join(playwrightRoot, 'lib', 'mcp', 'browser', 'tab.js');
  const tabModule = require(tabPath);
  const import_utils = require('playwright-core/lib/utils');
  const Tab = tabModule.Tab;
  const originalRefLocators = Tab.prototype.refLocators;

  Tab.prototype.refLocators = async function (params) {
    await this._initializedPromise;
    const results = [];
    for (const param of params) {
      let resolved = null;
      try {
        const out = await originalRefLocators.call(this, [param]);
        resolved = out[0];
      } catch (_) {
        // Try frame-by-frame: ref may be in an iframe. Snapshot uses f<frameSeq>e<id> (e.g. f1e2);
        // inside a frame the ref is just the element id (e.g. e2).
        const ref = String(param.ref || '');
        const frames = this.page.frames();
        const frameRefMatch = ref.match(/^f(\d+)e(.+)$/) || ref.match(/^f(\d+):e(.+)$/);
        const elementPart = frameRefMatch ? frameRefMatch[2] : ref;

        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          for (const tryRef of [ref, elementPart]) {
            try {
              const locator = frame.locator(`aria-ref=${tryRef}`).describe(param.element);
              const { resolvedSelector } = await locator._resolveSelector();
              resolved = {
                locator,
                resolved: (0, import_utils.asLocator)('javascript', resolvedSelector),
              };
              break;
            } catch (_e) {
              // continue
            }
          }
          if (resolved) break;
        }
      }
      if (!resolved) {
        throw new Error(
          `Ref ${param.ref} not found in the current page snapshot. Try capturing a new snapshot. If the element is inside an iframe, ensure the snapshot includes iframe content.`
        );
      }
      results.push(resolved);
    }
    return results;
  };
}

module.exports = { applyIframeSupport };
