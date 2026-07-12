function tokenize(str) {
  return new Set(
    (str || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2)
  );
}

function jaccardSimilarity(a, b) {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  let intersection = 0;
  setA.forEach(w => { if (setB.has(w)) intersection++; });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const DIFF_MATCH_THRESHOLD = 0.35;
const DIFF_IDENTICAL_THRESHOLD = 0.85;

/**
 * @param {Array} baseObligations  obligations from the circular on file
 * @param {Array} newObligations   obligations from the freshly extracted amended circular
 * @returns {{added:[], removed:[], modified:[{base, updated, similarity}], unchanged:[]}}
 */
function diffObligationSets(baseObligations, newObligations) {
  const matchedNewIds = new Set();
  const matchedBaseIds = new Set();
  const modified = [];
  const unchanged = [];

  baseObligations.forEach(baseObl => {
    let best = null;
    let bestScore = 0;
    newObligations.forEach(newObl => {
      if (matchedNewIds.has(newObl.id)) return;
      const score = jaccardSimilarity(baseObl.description, newObl.description);
      if (score > bestScore) { bestScore = score; best = newObl; }
    });

    if (best && bestScore >= DIFF_MATCH_THRESHOLD) {
      matchedNewIds.add(best.id);
      matchedBaseIds.add(baseObl.id);
      if (bestScore >= DIFF_IDENTICAL_THRESHOLD &&
          baseObl.deadline === best.deadline) {
        unchanged.push({ base: baseObl, updated: best, similarity: bestScore });
      } else {
        modified.push({ base: baseObl, updated: best, similarity: bestScore });
      }
    }
  });

  const removed = baseObligations.filter(o => !matchedBaseIds.has(o.id));
  const added = newObligations.filter(o => !matchedNewIds.has(o.id));

  return { added, removed, modified, unchanged };
}
