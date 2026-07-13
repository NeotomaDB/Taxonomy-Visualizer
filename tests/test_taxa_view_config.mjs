import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEARCH_COLLAPSIBLE_MATCH_THRESHOLD,
  getRadialOverviewDepth,
  getRadialSemanticLabelConfig,
  shouldAutoFocusCollapsibleSearch,
} from '../src/taxaViewConfig.js';

test('uses a deeper radial overview for vascular plants only', () => {
  assert.equal(getRadialOverviewDepth('VPL'), 3);
  assert.equal(getRadialOverviewDepth('MAM'), 1);
  assert.equal(getRadialOverviewDepth('AVE'), 1);
  assert.equal(getRadialOverviewDepth('ALG'), null);
});

test('limits semantic zoom node-circle scaling to algae', () => {
  assert.equal(getRadialSemanticLabelConfig('ALG')?.targetScreenNodeRadiusPx, 3.5);
  assert.equal(getRadialSemanticLabelConfig('ALG')?.targetScreenLeafNodeRadiusPx, 2.25);
  assert.equal(getRadialSemanticLabelConfig('MAM')?.targetScreenNodeRadiusPx, undefined);
});

test('auto-switches many-match searches only for standard radial biological groups', () => {
  assert.equal(SEARCH_COLLAPSIBLE_MATCH_THRESHOLD, 5);
  assert.equal(shouldAutoFocusCollapsibleSearch('ALG'), true);
  assert.equal(shouldAutoFocusCollapsibleSearch('DIN'), true);
  assert.equal(shouldAutoFocusCollapsibleSearch('MAM'), false);
  assert.equal(shouldAutoFocusCollapsibleSearch('VPL'), false);
  assert.equal(shouldAutoFocusCollapsibleSearch('INS'), false);
  assert.equal(shouldAutoFocusCollapsibleSearch('CHO'), false);
  assert.equal(shouldAutoFocusCollapsibleSearch('BIM'), false);
});
