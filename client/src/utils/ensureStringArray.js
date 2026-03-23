/**
 * Coerce every element of `arr` to a string.
 * LLM sometimes returns objects where strings are expected;
 * this prevents React error #31 ("Objects are not valid as a React child").
 */
export default function ensureStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(item => {
    if (typeof item === 'string') return item;
    if (item && typeof item === 'object') {
      if (typeof item.description === 'string') return item.description;
      const firstStr = Object.values(item).find(v => typeof v === 'string');
      if (firstStr) return firstStr;
      return JSON.stringify(item);
    }
    return String(item ?? '');
  });
}
