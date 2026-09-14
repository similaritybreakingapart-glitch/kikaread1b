// Dual Polish + English Translation Pipeline with Rich Synonyms & Fail-Safe Fallbacks
import { getCachedWord, setCachedWord, getCachedSentence, setCachedSentence } from './storage.js';

const TIMEOUT_MS = 3800;

function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error('Translation timeout')), ms));
}

export function cleanToken(raw) {
  if (!raw) return '';
  // Strip opening and closing quotes, punctuation, brackets, hyphens at edges
  return raw.replace(/^[\s„“"»«'(\[{<–—]+/, '').replace(/[\s„“"»«')\]}>–—.,!?;:]+$/, '');
}

/**
 * Parses Google's dict-chrome-ex response for rich synonyms & POS
 */
function parseDictionaryData(data) {
  let primary = '';
  let synonyms = [];
  let categories = [];
  let pos = '';

  // 1. Primary translation from sentence/word chunk
  if (data && data[0] && Array.isArray(data[0])) {
    primary = data[0].map(item => item[0]).filter(Boolean).join(' ').trim();
  }

  // 2. Dictionary breakdown with POS & alternative meanings
  if (data && data[1] && Array.isArray(data[1])) {
    const synSet = new Set();
    data[1].forEach(block => {
      const blockPos = block[0] || '';
      if (!pos && blockPos) pos = blockPos;
      
      const blockSynonyms = [];
      if (Array.isArray(block[1])) {
        block[1].forEach(syn => {
          if (syn) {
            blockSynonyms.push(syn);
            if (syn.toLowerCase() !== primary.toLowerCase()) {
              synSet.add(syn);
            }
          }
        });
      }

      if (blockPos && blockSynonyms.length > 0) {
        categories.push({
          pos: blockPos,
          synonyms: blockSynonyms.slice(0, 6)
        });
      }
    });
    synonyms = Array.from(synSet).slice(0, 8);
  }

  return { primary, synonyms, categories, pos };
}

/**
 * Fallback to MyMemory translation API if primary endpoint fails
 */
async function fetchMyMemory(text, fromLang, toLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${fromLang}|${toLang}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`MyMemory HTTP ${resp.status}`);
  const json = await resp.json();
  const primary = (json.responseData && json.responseData.translatedText) || '';
  const synonyms = [];
  if (Array.isArray(json.matches)) {
    json.matches.forEach(m => {
      const t = m.translation && m.translation.trim();
      if (t && t.toLowerCase() !== primary.toLowerCase() && !synonyms.includes(t)) {
        synonyms.push(t);
      }
    });
  }
  return { primary, synonyms: synonyms.slice(0, 5), pos: '' };
}

/**
 * Fetch a single language word translation with timeout and fallback
 */
async function fetchWordLanguage(word, targetLang) {
  const googleUrl = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=de&tl=${targetLang}&dt=t&dt=bd&q=${encodeURIComponent(word)}`;
  
  try {
    const fetchPromise = fetch(googleUrl).then(async (res) => {
      if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
      return res.json();
    });
    const data = await Promise.race([fetchPromise, timeoutPromise(TIMEOUT_MS)]);
    const parsed = parseDictionaryData(data);
    if (parsed.primary) return parsed;
  } catch (err) {
    console.warn(`Primary dictionary failed for ${word} (${targetLang}):`, err.message);
  }

  // Fallback to MyMemory
  try {
    return await Promise.race([fetchMyMemory(word, 'de', targetLang), timeoutPromise(TIMEOUT_MS)]);
  } catch (err) {
    console.error(`All fallbacks failed for ${word} (${targetLang}):`, err.message);
    return { primary: '[Translation unavailable]', synonyms: [], pos: '' };
  }
}

/**
 * Translate a single German word into BOTH Polish and English simultaneously
 */
export async function translateWord(rawWord) {
  const word = cleanToken(rawWord);
  if (!word) return null;

  // 1. Check local on-device cache
  const cached = await getCachedWord(word);
  if (cached && cached.pl && cached.en) {
    return { ...cached, fromCache: true };
  }

  // 2. Fetch Polish & English in parallel
  const [plResult, enResult] = await Promise.all([
    fetchWordLanguage(word, 'pl'),
    fetchWordLanguage(word, 'en')
  ]);

  const result = {
    word,
    original: rawWord,
    pl: plResult,
    en: enResult,
    pos: plResult.pos || enResult.pos || '',
  };

  // 3. Persist to on-device cache for instant offline reuse
  if (result.pl.primary && !result.pl.primary.includes('unavailable')) {
    await setCachedWord(result);
  }

  return { ...result, fromCache: false };
}

/**
 * Translate a full German sentence into BOTH Polish and English
 */
export async function translateSentence(sentenceText) {
  const text = sentenceText.trim();
  if (!text) return null;

  // 1. Check sentence cache
  const cached = await getCachedSentence(text);
  if (cached && cached.pl && cached.en) {
    return { sentence: text, pl: cached.pl, en: cached.en, fromCache: true };
  }

  // 2. Fetch sentence translations in parallel
  async function fetchSent(targetLang) {
    const url = `https://translate.googleapis.com/translate_a/single?client=dict-chrome-ex&sl=de&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    try {
      const fetchPromise = fetch(url).then(async (res) => {
        if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
        const data = await res.json();
        if (data && data[0]) {
          return data[0].map(item => item[0]).filter(Boolean).join('').trim();
        }
        return '';
      });
      return await Promise.race([fetchPromise, timeoutPromise(TIMEOUT_MS)]);
    } catch {
      // Fallback
      const fb = await fetchMyMemory(text, 'de', targetLang);
      return fb.primary || '';
    }
  }

  const [plTranslation, enTranslation] = await Promise.all([
    fetchSent('pl'),
    fetchSent('en')
  ]);

  // 3. Cache sentence
  if (plTranslation && enTranslation) {
    await setCachedSentence(text, plTranslation, enTranslation);
  }

  return {
    sentence: text,
    pl: plTranslation || '[Translation unavailable]',
    en: enTranslation || '[Translation unavailable]',
    fromCache: false
  };
}
