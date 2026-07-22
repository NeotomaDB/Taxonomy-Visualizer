// applyAngleCulling — hide leaf labels that are too close together angularly.
//
// `getNodeSel`: a function () => D3 selection, called fresh on every recompute
//   so that newly entered nodes (after expand) are always included.
//   Alternatively pass a static selection; refresh() will still requery leaves.
export function applyAngleCulling(root, getNodeSel, minDeg = 0.9) {
  let threshold = (minDeg * Math.PI) / 180;

  function recompute() {
    // Always recompute from current tree structure so expand/collapse is reflected.
    const leaves = root.leaves().slice().sort((a, b) => a.x - b.x);
    const visible = new Set();
    for (let i = 0; i < leaves.length; i++) {
      const prev = leaves[(i - 1 + leaves.length) % leaves.length];
      const next = leaves[(i + 1) % leaves.length];
      const dθ = Math.min(
        Math.abs(leaves[i].x - prev.x),
        Math.abs(next.x - leaves[i].x)
      );
      if (dθ >= threshold) visible.add(leaves[i]);
    }
    // Re-query the live DOM so newly entered nodes are included.
    const sel = typeof getNodeSel === 'function' ? getNodeSel() : getNodeSel;
    sel.select('text')
      .style('display', function (d) {
        // Selection-path labels are deliberately protected from the regular
        // internal-node/angle culling pass.
        if (this.classList.contains('focused-text') || this.classList.contains('path-context-label')) {
          return 'block';
        }
        return d.children ? 'none' : (visible.has(d) ? 'block' : 'none');
      });
  }

  let lastK = null;
  function updateByScale(k) {
    if (lastK === k) return; // Skip if only panning (k didn't change)
    lastK = k;
    const base = (minDeg * Math.PI) / 180;
    threshold = base / Math.max(1, Math.sqrt(k));
    recompute();
  }

  recompute();
  return { updateByScale, refresh: recompute };
}

function rectsOverlap(a, b, padding) {
  return a.left < b.right + padding &&
    a.right > b.left - padding &&
    a.top < b.bottom + padding &&
    a.bottom > b.top - padding;
}

function isForcedLabel(element) {
  return element.classList.contains('highlight') ||
    element.classList.contains('highlight-synonym') ||
    element.classList.contains('highlight-q1') ||
    element.classList.contains('highlight-q2') ||
    element.classList.contains('focused-text') ||
    element.classList.contains('path-context-label');
}

export function applySemanticZoomLabels(root, getNodeSel, options = {}) {
  const tiers = (options.tiers || []).slice().sort((a, b) => a.minScale - b.minScale);
  const targetScreenFontPx = options.targetScreenFontPx || 11;
  const collisionPaddingPx = options.collisionPaddingPx ?? 4;
  const nodeCollisionPaddingPx = options.nodeCollisionPaddingPx ?? 2;
  const nodeRadius = options.nodeRadius ?? 3.5;
  const nodeGapScreenPx = options.nodeGapScreenPx ?? 6;
  const protectedInternalDepth = options.protectedInternalDepth ?? 5;
  const offsetAttemptsScreenPx = options.offsetAttemptsScreenPx || [0, 8, 16, 24];
  const viewportPaddingPx = options.viewportPaddingPx ?? 8;
  const viewportElement = options.viewportElement || null;
  const getObstacleElements = options.getObstacleElements || null;
  const rootBadgeElement = options.rootBadgeElement || null;
  let transform = { k: 1, x: 0, y: 0 };
  let frameId = null;

  function getTier(k) {
    let activeTier = tiers[0] || {
      minScale: 0,
      maxInternalDepth: Infinity,
      maxLeafDepth: Infinity,
    };
    tiers.forEach(tier => {
      if (k >= tier.minScale) activeTier = tier;
    });
    return activeTier;
  }

  function hasDescendants(d) {
    return Boolean((d.children && d.children.length) || (d._children && d._children.length));
  }

  function isTierEligible(d, tier) {
    if (!d || d.depth === 0) return false;
    const maxDepth = hasDescendants(d) ? tier.maxInternalDepth : tier.maxLeafDepth;
    return d.depth <= maxDepth;
  }

  function isInsideViewport(rect, viewportRect) {
    return rect.right >= viewportRect.left - viewportPaddingPx &&
      rect.left <= viewportRect.right + viewportPaddingPx &&
      rect.bottom >= viewportRect.top - viewportPaddingPx &&
      rect.top <= viewportRect.bottom + viewportPaddingPx;
  }

  function recompute() {
    frameId = null;
    const k = Math.max(0.01, transform.k || 1);
    const tier = getTier(k);
    const nodeSelection = typeof getNodeSel === 'function' ? getNodeSel() : getNodeSel;
    const labels = nodeSelection.select('text.taxon-label');
    const fontSize = Math.max(1.5, Math.min(36, targetScreenFontPx / k));
    const baseLabelOffset = nodeRadius + (nodeGapScreenPx / k);
    const candidates = [];
    let rootIsHighlighted = false;

    labels.each(function (d) {
      const label = d3.select(this);
      const forced = isForcedLabel(this);
      if (!d || d.depth === 0) {
        rootIsHighlighted = rootIsHighlighted || forced;
        this.style.setProperty('display', 'none', 'important');
        return;
      }
      const eligible = forced || isTierEligible(d, tier);
      const currentX = Number(this.getAttribute('x')) || 10;
      const direction = currentX < 0 ? -1 : 1;

      label
        .style('font-size', `${fontSize}px`, 'important')
        .attr('x', direction * baseLabelOffset)
        .style('display', eligible ? 'block' : 'none')
        .style('visibility', eligible ? 'hidden' : null)
        .style('opacity', eligible ? 0 : null);

      if (eligible) {
        candidates.push({
          element: this,
          data: d,
          direction,
          forced,
          internal: hasDescendants(d),
          protected: forced || (hasDescendants(d) && d.depth <= protectedInternalDepth),
        });
      }
    });

    rootBadgeElement?.classList.toggle('is-path-highlighted', rootIsHighlighted);

    const viewportRect = viewportElement?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };

    const obstacleRects = [];
    nodeSelection.each(function () {
      const directCircle = Array.from(this.children).find(child => child.tagName?.toLowerCase() === 'circle');
      const toggleCircle = this.querySelector('.toggle-group circle');
      [directCircle, toggleCircle].filter(Boolean).forEach(element => {
        const style = window.getComputedStyle(element);
        const toggleGroup = element.closest('.toggle-group');
        const toggleStyle = toggleGroup ? window.getComputedStyle(toggleGroup) : null;
        const rect = element.getBoundingClientRect();
        const isVisible = style.display !== 'none' &&
          Number(style.opacity) > 0 &&
          (!toggleStyle || (toggleStyle.display !== 'none' && Number(toggleStyle.opacity) > 0));
        if (isVisible && rect.width > 0 && rect.height > 0) {
          obstacleRects.push(rect);
        }
      });
    });
    const extraObstacleElements = typeof getObstacleElements === 'function'
      ? getObstacleElements()
      : [];
    (extraObstacleElements || []).filter(Boolean).forEach(element => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) obstacleRects.push(rect);
    });

    candidates.sort((a, b) => {
      if (a.forced !== b.forced) return a.forced ? -1 : 1;
      if (a.internal !== b.internal) return a.internal ? -1 : 1;
      if (a.data.depth !== b.data.depth) return a.data.depth - b.data.depth;
      return a.data.x - b.data.x;
    });

    const acceptedRects = [];
    const protectedVisibleCandidates = [];
    candidates.forEach(candidate => {
      const label = d3.select(candidate.element);
      let bestAttempt = null;
      let protectedAttempt = null;

      for (const extraScreenPx of offsetAttemptsScreenPx) {
        const x = candidate.direction * (baseLabelOffset + (extraScreenPx / k));
        label.attr('x', x);
        const rect = candidate.element.getBoundingClientRect();
        const inViewport = candidate.forced || isInsideViewport(rect, viewportRect);
        const nodeCollisions = obstacleRects.filter(obstacle =>
          rectsOverlap(rect, obstacle, nodeCollisionPaddingPx)
        ).length;
        const labelCollisions = acceptedRects.filter(accepted =>
          rectsOverlap(rect, accepted, collisionPaddingPx)
        ).length;
        const score = nodeCollisions + labelCollisions;
        const attempt = { x, rect, inViewport, score, nodeCollisions, labelCollisions };

        if (!bestAttempt || score < bestAttempt.score) bestAttempt = attempt;
        if (candidate.protected && labelCollisions === 0 &&
            (!protectedAttempt || nodeCollisions < protectedAttempt.nodeCollisions)) {
          protectedAttempt = attempt;
        }
        if (inViewport && score === 0) {
          bestAttempt = attempt;
          break;
        }
      }

      if (candidate.protected && bestAttempt?.score !== 0 && protectedAttempt) {
        bestAttempt = protectedAttempt;
      }
      const visible = Boolean(bestAttempt?.inViewport) && (
        bestAttempt.score === 0 ||
        candidate.forced ||
        (candidate.protected && bestAttempt.labelCollisions === 0)
      );
      if (bestAttempt) label.attr('x', bestAttempt.x);

      label
        .style('display', visible ? 'block' : 'none')
        .style('visibility', visible ? 'visible' : null)
        .style('opacity', visible ? 1 : null)
        .style('paint-order', visible ? 'stroke fill' : null)
        .style('stroke', visible ? '#fff' : null)
        .style('stroke-width', visible ? `${2.5 / k}px` : null)
        .style('stroke-linejoin', visible ? 'round' : null);

      if (visible) {
        acceptedRects.push(bestAttempt.rect);
        if (candidate.protected) protectedVisibleCandidates.push(candidate);
      }
    });

    // Keep selected and shallow hierarchy labels above descendant node circles.
    // Deepest groups are raised first so the highest-level label wins last.
    protectedVisibleCandidates
      .sort((a, b) => b.data.depth - a.data.depth)
      .forEach(candidate => candidate.element.parentNode?.parentNode?.appendChild(candidate.element.parentNode));
  }

  function schedule(nextTransform = transform) {
    transform = {
      k: nextTransform.k ?? transform.k,
      x: nextTransform.x ?? transform.x,
      y: nextTransform.y ?? transform.y,
    };
    if (frameId != null) return;
    frameId = window.requestAnimationFrame(recompute);
  }

  recompute();
  return {
    update: schedule,
    updateByScale: k => schedule({ ...transform, k }),
    refresh: recompute,
  };
}
