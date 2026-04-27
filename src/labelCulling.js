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
