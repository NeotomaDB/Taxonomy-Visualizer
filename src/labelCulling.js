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
      .style('display', d => d.children ? 'none' : (visible.has(d) ? 'block' : 'none'));
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
    element.classList.contains('focused-text');
}

export function applySemanticZoomLabels(root, getNodeSel, options = {}) {
  const tiers = (options.tiers || []).slice().sort((a, b) => a.minScale - b.minScale);
  const targetScreenFontPx = options.targetScreenFontPx || 11;
  const collisionPaddingPx = options.collisionPaddingPx ?? 4;
  const viewportPaddingPx = options.viewportPaddingPx ?? 8;
  const viewportElement = options.viewportElement || null;
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
    const labelOffset = Math.max(1.5, 10 / k);
    const candidates = [];

    labels.each(function (d) {
      const label = d3.select(this);
      const forced = isForcedLabel(this);
      const eligible = forced || isTierEligible(d, tier);
      const currentX = Number(this.getAttribute('x')) || 10;

      label
        .style('font-size', `${fontSize}px`, 'important')
        .attr('x', currentX < 0 ? -labelOffset : labelOffset)
        .style('display', eligible ? 'block' : 'none')
        .style('visibility', eligible ? 'hidden' : null)
        .style('opacity', eligible ? 0 : null);

      if (eligible) {
        candidates.push({ element: this, data: d, forced, internal: hasDescendants(d) });
      }
    });

    const viewportRect = viewportElement?.getBoundingClientRect() || {
      left: 0,
      top: 0,
      right: window.innerWidth,
      bottom: window.innerHeight,
    };

    candidates.forEach(candidate => {
      candidate.rect = candidate.element.getBoundingClientRect();
      candidate.inViewport = candidate.forced || isInsideViewport(candidate.rect, viewportRect);
    });

    candidates.sort((a, b) => {
      if (a.forced !== b.forced) return a.forced ? -1 : 1;
      if (a.internal !== b.internal) return a.internal ? -1 : 1;
      if (a.data.depth !== b.data.depth) return a.data.depth - b.data.depth;
      return a.data.x - b.data.x;
    });

    const acceptedRects = [];
    candidates.forEach(candidate => {
      const collides = !candidate.forced && acceptedRects.some(rect =>
        rectsOverlap(candidate.rect, rect, collisionPaddingPx)
      );
      const visible = candidate.inViewport && !collides;
      const label = d3.select(candidate.element);

      label
        .style('display', visible ? 'block' : 'none')
        .style('visibility', visible ? 'visible' : null)
        .style('opacity', visible ? 1 : null);

      if (visible) acceptedRects.push(candidate.rect);
    });
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
