// Ultra-fast client-side EPUB parser & tokenized sentence reader
import JSZip from 'jszip';

// Common German abbreviations to avoid splitting sentences incorrectly
const ABBREVIATIONS = [
  'z.B.', 'd.h.', 'u.a.', 'bzw.', 'ca.', 'usw.', 'etc.',
  'Dr.', 'Prof.', 'Hr.', 'Fr.', 'Nr.', 'Abs.', 'Art.', 'Bd.', 'vgl.'
];

/**
 * Split text into clean sentences while respecting German abbreviations and quotes
 */
export function splitSentences(rawText) {
  if (!rawText) return [];
  
  // Protect abbreviations with a placeholder
  let text = rawText.trim();
  const placeholders = [];
  ABBREVIATIONS.forEach((abbr, i) => {
    const p = `__ABBR_${i}__`;
    const escaped = abbr.replace(/\./g, '\\.');
    const regex = new RegExp(`\\b${escaped}`, 'gi');
    if (regex.test(text)) {
      text = text.replace(regex, p);
      placeholders.push({ placeholder: p, original: abbr });
    }
  });

  // Regex to split on sentence boundaries
  // Look behind for . ! ? or quote, followed by space, and look ahead for uppercase letter
  const rawSentences = text
    .split(/(?<=[.?!…»”"'])\s+(?=[A-ZÄÖÜ„"«'0-9])/g)
    .map(s => s.trim())
    .filter(Boolean);

  // Restore placeholders
  return rawSentences.map(sent => {
    let restored = sent;
    placeholders.forEach(({ placeholder, original }) => {
      restored = restored.replaceAll(placeholder, original);
    });
    return restored;
  });
}

/**
 * Tokenize a sentence into words and whitespace/punctuation tokens
 */
export function tokenizeSentence(sentence) {
  // Matches words (including German umlauts and hyphens) vs non-word punctuation/spaces
  const tokens = [];
  const regex = /([a-zA-ZäöüÄÖÜß]+(?:-[a-zA-ZäöüÄÖÜß]+)*)|([^a-zA-ZäöüÄÖÜß\s]+)|(\s+)/g;
  let match;

  while ((match = regex.exec(sentence)) !== null) {
    if (match[1]) {
      // Word token
      tokens.push({ type: 'word', text: match[1] });
    } else if (match[2]) {
      // Punctuation
      tokens.push({ type: 'punct', text: match[2] });
    } else if (match[3]) {
      // Whitespace
      tokens.push({ type: 'space', text: match[3] });
    }
  }

  return tokens;
}

/**
 * Parse an EPUB ArrayBuffer directly in pure JS (super fast, no iframes)
 */
export async function parseEpub(arrayBuffer) {
  const zip = await JSZip.loadAsync(arrayBuffer);
  
  // 1. Find container.xml to locate OPF file
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Invalid EPUB: missing container.xml');
  const containerXml = await containerFile.async('text');
  
  const domParser = new DOMParser();
  const containerDoc = domParser.parseFromString(containerXml, 'application/xml');
  const rootfileElem = containerDoc.querySelector('rootfile');
  const opfPath = rootfileElem ? rootfileElem.getAttribute('full-path') : 'OEBPS/content.opf';
  
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`Invalid EPUB: missing ${opfPath}`);
  const opfXml = await opfFile.async('text');
  const opfDoc = domParser.parseFromString(opfXml, 'application/xml');

  // Base directory of the OPF file
  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

  // 2. Extract Metadata
  const titleElem = opfDoc.querySelector('title');
  const creatorElem = opfDoc.querySelector('creator');
  const title = titleElem ? titleElem.textContent.trim() : 'Unknown Book';
  const author = creatorElem ? creatorElem.textContent.trim() : 'Unknown Author';

  // 3. Manifest items
  const manifestItems = {};
  opfDoc.querySelectorAll('manifest > item').forEach(item => {
    manifestItems[item.getAttribute('id')] = item.getAttribute('href');
  });

  // 4. Spine items (reading order)
  const spineHrefs = [];
  opfDoc.querySelectorAll('spine > itemref').forEach(itemref => {
    const idref = itemref.getAttribute('idref');
    const href = manifestItems[idref];
    if (href) {
      spineHrefs.push(opfDir ? `${opfDir}${href}` : href);
    }
  });

  // 5. Extract chapters & sentences
  const chapters = [];
  let totalSentences = 0;

  for (let idx = 0; idx < spineHrefs.length; idx++) {
    const href = spineHrefs[idx];
    const file = zip.file(href) || zip.file(decodeURIComponent(href));
    if (!file) continue;

    const htmlContent = await file.async('text');
    const doc = domParser.parseFromString(htmlContent, 'text/html');

    // Remove scripts and style tags
    doc.querySelectorAll('script, style').forEach(el => el.remove());

    // Extract title from h1-h3 or fallback
    const h = doc.querySelector('h1, h2, h3');
    const chapterTitle = h ? h.textContent.trim() : `Chapter ${idx + 1}`;

    // Extract text blocks (p, div, blockquote, li, h1-h6)
    const blocks = [];
    const textNodes = doc.querySelectorAll('p, div, blockquote, li, h1, h2, h3, h4, h5, h6');
    
    if (textNodes.length > 0) {
      textNodes.forEach(node => {
        const text = node.textContent.trim();
        if (text && text.length > 1) {
          blocks.push(text);
        }
      });
    } else {
      const bodyText = doc.body ? doc.body.textContent.trim() : '';
      if (bodyText) blocks.push(bodyText);
    }

    // Split blocks into sentences
    const chapterSentences = [];
    blocks.forEach(block => {
      const sents = splitSentences(block);
      chapterSentences.push(...sents);
    });

    if (chapterSentences.length > 0) {
      chapters.push({
        index: chapters.length,
        title: chapterTitle,
        sentences: chapterSentences,
        startSentenceIndex: totalSentences,
      });
      totalSentences += chapterSentences.length;
    }
  }

  return {
    title,
    author,
    chapters,
    totalSentences,
  };
}
