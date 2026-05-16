// ============================================================
// docSearchService — lightweight BM25 text retrieval (pure JS)
//
// Designed for 4GB RAM servers: no external deps, CJK-aware
// tokenization, ~1MB memory for 20 docs x 50K chars.
// ============================================================

const K1 = 1.2;
const B = 0.75;

function tokenize(text) {
  if (!text) return [];
  const tokens = [];
  // Split on whitespace + punctuation boundaries, keep CJK chars as individual tokens
  const re = /[一-鿿㐀-䶿]|[a-zA-Z0-9]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push(m[0].toLowerCase());
  }
  return tokens;
}

function chunkText(text, chunkSize = 800, overlap = 100) {
  if (!text || text.length <= chunkSize) return text ? [text] : [];
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + chunkSize));
    start += chunkSize - overlap;
  }
  return chunks;
}

function bm25Search(query, documents, topK = 8) {
  if (!query || !documents || documents.length === 0) return [];

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return documents.slice(0, topK).map((d, i) => ({ index: i, ...d, score: 0 }));

  // Build corpus stats
  const N = documents.length;
  const docTokens = documents.map((d) => tokenize(d.text));
  const avgDl = docTokens.reduce((s, t) => s + t.length, 0) / N || 1;

  // DF for each term
  const df = {};
  for (const term of queryTokens) {
    if (df[term] !== undefined) continue;
    let count = 0;
    for (const dt of docTokens) {
      if (dt.includes(term)) count++;
    }
    df[term] = count;
  }

  // Score each document
  const scored = documents.map((doc, i) => {
    const tokens = docTokens[i];
    const dl = tokens.length;

    // Build TF map for this doc
    const tf = {};
    for (const t of tokens) {
      tf[t] = (tf[t] || 0) + 1;
    }

    let score = 0;
    for (const term of queryTokens) {
      const termTf = tf[term] || 0;
      if (termTf === 0) continue;
      const termDf = df[term] || 0;
      const idf = Math.log((N - termDf + 0.5) / (termDf + 0.5) + 1);
      const tfNorm = (termTf * (K1 + 1)) / (termTf + K1 * (1 - B + B * dl / avgDl));
      score += idf * tfNorm;
    }

    return { index: i, text: doc.text, source: doc.source, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

module.exports = { tokenize, chunkText, bm25Search };
