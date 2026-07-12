async function extractObligationsWithAI(circularText, intermediaryType) {
  if (!circularText || !circularText.trim()) {
    throw new Error('No circular text to extract obligations from.');
  }

  const parsed = await apiFetch('/api/extract-obligations', {
    method: 'POST',
    body: JSON.stringify({ circularText, intermediaryType })
  });

  if (!Array.isArray(parsed)) {
    throw new Error('Backend response was valid JSON but not an array of obligations.');
  }

  return parsed.map((o, i) => ({
    id: `OBL-${Date.now().toString(36).toUpperCase()}-${String(i + 1).padStart(2, '0')}`,
    description: o.description || '(no description returned)',
    category: o.category || 'Other',
    deadline: o.deadline || 'Not specified',
    intermediaryType: o.intermediary_type || o.intermediaryType || intermediaryType,
    sourceExcerpt: o.source_excerpt || o.sourceExcerpt || '',
    status: 'Missing',
    evidenceNote: '',
    evidenceFileName: '',
    updatedAt: new Date().toISOString()
  }));
}
