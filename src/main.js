import './styles/reader.css';
import { parseEpub, tokenizeSentence } from './reader.js';
import { translateWord, translateSentence, cleanToken } from './dictionary.js';
import { speakGerman, stopSpeech } from './tts.js';
import {
  saveBook,
  getAllBooks,
  getBookData,
  deleteBook,
  saveProgress,
  getProgress,
  setWordTag,
  deleteWordTag,
  getAllWordTags
} from './storage.js';

// --- State ---
let currentBook = null;
let currentChapterIndex = 0;
let currentPageIndex = 0;
const SENTENCES_PER_PAGE = 22; // Comfortable, book-like page length

let activeWord = '';
let activeSentence = '';
let currentTheme = localStorage.getItem('kika_theme') || 'warm';
let quizEnabled = localStorage.getItem('kika_quiz_enabled') !== 'false';
let quizFrequency = localStorage.getItem('kika_quiz_freq') || 'page'; // 'page' or 'chapter'
let wordTagsMap = {}; // word -> { word, status: 'learned' | 'learning', contextSentence }

// Multi-tap detection
let tapCount = 0;
let tapTimer = null;

// --- DOM Elements ---
const libraryView = document.getElementById('library-view');
const readerView = document.getElementById('reader-view');
const booksList = document.getElementById('books-list');
const epubInput = document.getElementById('epub-input');
const btnAddBook = document.getElementById('btn-add-book');
const btnLibrary = document.getElementById('btn-library');
const btnChapters = document.getElementById('btn-chapters');
const btnTheme = document.getElementById('btn-theme');
const themeIcon = document.getElementById('theme-icon');
const headerTitle = document.getElementById('header-title');
const progressBar = document.getElementById('progress-bar');
const readerContent = document.getElementById('reader-content');

// Pagination elements
const btnPrevChapter = document.getElementById('btn-prev-chapter');
const btnNextChapter = document.getElementById('btn-next-chapter');
const pageIndicator = document.getElementById('page-indicator');
const topNavArrows = document.getElementById('top-nav-arrows');
const btnTopPrev = document.getElementById('btn-top-prev');
const btnTopNext = document.getElementById('btn-top-next');

// Translation Drawer Elements
const drawer = document.getElementById('translation-drawer');
const drawerDrag = document.getElementById('drawer-drag');

// Drawer Mode Containers
const drawerWordMode = document.getElementById('drawer-word-mode');
const drawerSentenceMode = document.getElementById('drawer-sentence-mode');

// Word UI Elements
const trWord = document.getElementById('tr-word');
const trPos = document.getElementById('tr-pos');
const trEnPrimary = document.getElementById('tr-en-primary');
const trEnSynonyms = document.getElementById('tr-en-synonyms');
const trEnCategories = document.getElementById('tr-en-categories');
const trPlPrimary = document.getElementById('tr-pl-primary');
const trPlSynonyms = document.getElementById('tr-pl-synonyms');
const trPlCategories = document.getElementById('tr-pl-categories');
const btnTts = document.getElementById('btn-tts');
const btnTriggerSentTr = document.getElementById('btn-trigger-sent-tr');

// Sentence UI Elements
const sentOrigText = document.getElementById('sent-orig-text');
const sentEnText = document.getElementById('sent-en-text');
const sentPlText = document.getElementById('sent-pl-text');
const btnSentTts = document.getElementById('btn-sent-tts');

// Chapters Modal
const chapterModal = document.getElementById('chapter-modal');
const chaptersList = document.getElementById('chapters-list');
const btnCloseChapters = document.getElementById('btn-close-chapters');

// Mini Quiz Elements
const quizModal = document.getElementById('quiz-modal');
const quizProgressText = document.getElementById('quiz-progress-text');
const quizWord = document.getElementById('quiz-word');
const quizContext = document.getElementById('quiz-context');
const quizAnswerArea = document.getElementById('quiz-answer-area');
const quizEnAnswer = document.getElementById('quiz-en-answer');
const quizEnSyns = document.getElementById('quiz-en-syns');
const quizPlAnswer = document.getElementById('quiz-pl-answer');
const quizPlSyns = document.getElementById('quiz-pl-syns');
const btnQuizTts = document.getElementById('btn-quiz-tts');
const btnQuizReveal = document.getElementById('btn-quiz-reveal');
const btnQuizNext = document.getElementById('btn-quiz-next');
const quizNextActions = document.getElementById('quiz-next-actions');
const btnSkipQuiz = document.getElementById('btn-skip-quiz');
const chkQuizEnabled = document.getElementById('chk-quiz-enabled');
const btnQuizFreqPage = document.getElementById('btn-quiz-freq-page');
const btnQuizFreqChapter = document.getElementById('btn-quiz-freq-chapter');

// Quiz State
let quizCards = [];
let quizCurrentIndex = 0;
let pendingNextAction = null;

// Translation SVG Icon (Bilingual A / 文 Glyph)
const TRANSLATE_ICON_SVG = `
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 5h7M7 2v3M9 5c0 4.5-2.5 8-6 8"/>
    <path d="M5 9c1.5 2 3.5 3.5 5 4.5"/>
    <path d="M12 20l4-9 4 9M13.8 16h4.4"/>
  </svg>
`;

// --- Initialization ---
async function init() {
  applyTheme(currentTheme);
  chkQuizEnabled.checked = quizEnabled;
  updateQuizFreqButtons();
  wordTagsMap = await getAllWordTags();
  
  if (btnTriggerSentTr) {
    btnTriggerSentTr.innerHTML = `${TRANSLATE_ICON_SVG} Translate Full Sentence`;
  }

  wireEvents();
  loadLibrary();
}

function updateQuizFreqButtons() {
  if (quizFrequency === 'page') {
    btnQuizFreqPage.classList.add('active');
    btnQuizFreqChapter.classList.remove('active');
  } else {
    btnQuizFreqChapter.classList.add('active');
    btnQuizFreqPage.classList.remove('active');
  }
}

function setQuizFrequency(freq) {
  quizFrequency = freq;
  localStorage.setItem('kika_quiz_freq', freq);
  updateQuizFreqButtons();
}

function cycleTheme() {
  let nextTheme = 'warm';
  if (currentTheme === 'warm') nextTheme = 'dark';
  else if (currentTheme === 'dark') nextTheme = 'light';
  else nextTheme = 'warm';
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  currentTheme = theme;
  document.body.setAttribute('data-theme', theme);
  localStorage.setItem('kika_theme', theme);
  
  if (theme === 'dark') {
    themeIcon.innerHTML = '<path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/>';
    btnTheme.title = 'Current: Dark Mode (Click for Light)';
  } else if (theme === 'light') {
    themeIcon.innerHTML = '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>';
    btnTheme.title = 'Current: Clean Light (Click for Warm Paper)';
  } else {
    themeIcon.innerHTML = '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
    btnTheme.title = 'Current: Warm Paper (Click for Dark)';
  }
}

function wireEvents() {
  btnTheme.addEventListener('click', cycleTheme);

  // Open EPUB Picker
  btnAddBook.addEventListener('click', () => epubInput.click());
  epubInput.addEventListener('change', handleEpubUpload);

  // Return to Library
  btnLibrary.addEventListener('click', showLibrary);

  // Chapter Modal Toggle
  btnChapters.addEventListener('click', () => chapterModal.classList.add('open'));
  pageIndicator.addEventListener('click', () => chapterModal.classList.add('open'));
  if (btnCloseChapters) {
    btnCloseChapters.addEventListener('click', () => chapterModal.classList.remove('open'));
  }
  chapterModal.addEventListener('click', (e) => {
    if (e.target === chapterModal) chapterModal.classList.remove('open');
  });

  // Page Navigation buttons (bottom & top)
  btnPrevChapter.addEventListener('click', prevPage);
  btnNextChapter.addEventListener('click', nextPage);
  btnTopPrev.addEventListener('click', prevPage);
  btnTopNext.addEventListener('click', nextPage);

  // Keyboard navigation on PC (Arrow Left / Right)
  window.addEventListener('keydown', (e) => {
    if (readerView.style.display !== 'block' || quizModal.classList.contains('open')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      nextPage();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      prevPage();
    }
  });

  // Touch Swipe navigation on mobile
  let touchStartX = 0;
  let touchStartY = 0;
  readerView.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }, { passive: true });

  readerView.addEventListener('touchend', (e) => {
    if (quizModal.classList.contains('open')) return;
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    if (Math.abs(diffX) > 75 && Math.abs(diffY) < 60) {
      if (diffX < 0) {
        nextPage();
      } else {
        prevPage();
      }
    }
  }, { passive: true });

  // Close Drawer
  drawerDrag.addEventListener('click', closeDrawer);
  readerView.addEventListener('click', (e) => {
    if (!e.target.closest('.word-token') && !e.target.closest('.sentence-expand-btn') && !e.target.closest('.translation-drawer')) {
      closeDrawer();
    }
  });

  // TTS audio buttons
  btnTts.addEventListener('click', () => {
    if (activeWord) speakGerman(activeWord);
  });

  btnSentTts.addEventListener('click', () => {
    if (activeSentence) speakGerman(activeSentence);
  });

  // Trigger Sentence Translation from word mode
  btnTriggerSentTr.addEventListener('click', () => {
    if (activeSentence) {
      openSentenceMode(activeSentence);
    }
  });

  // Quiz Event Listeners
  btnQuizTts.addEventListener('click', () => {
    const card = quizCards[quizCurrentIndex];
    if (card) speakGerman(card.word);
  });

  btnQuizReveal.addEventListener('click', revealQuizAnswer);
  btnQuizNext.addEventListener('click', advanceQuiz);
  btnSkipQuiz.addEventListener('click', finishQuiz);

  chkQuizEnabled.addEventListener('change', (e) => {
    quizEnabled = e.target.checked;
    localStorage.setItem('kika_quiz_enabled', quizEnabled);
  });

  btnQuizFreqPage.addEventListener('click', () => setQuizFrequency('page'));
  btnQuizFreqChapter.addEventListener('click', () => setQuizFrequency('chapter'));

  // Reader Scroll Tracking (debounced)
  let scrollTimeout;
  readerView.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(handleScrollProgress, 120);
  });
}

// --- Library & Book Handling ---
async function loadLibrary() {
  const books = await getAllBooks();
  booksList.innerHTML = '';

  if (!books || books.length === 0) {
    booksList.innerHTML = `
      <div style="text-align:center; padding: 40px 20px; color: var(--text-faint);">
        No books loaded yet. Tap "Open EPUB Book" above to load any German EPUB!
      </div>
    `;
    return;
  }

  books.forEach(b => {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.innerHTML = `
      <div class="book-info">
        <h3>${escapeHtml(b.title)}</h3>
        <p>${escapeHtml(b.author || 'Unknown Author')}</p>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <button class="icon-btn delete-btn" title="Delete Book" style="color:var(--text-faint);">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) {
        e.stopPropagation();
        if (confirm(`Remove "${b.title}" from library?`)) {
          deleteBook(b.id).then(loadLibrary);
        }
        return;
      }
      openBook(b.id);
    });

    booksList.appendChild(card);
  });
}

async function handleEpubUpload(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    btnAddBook.innerHTML = '<span>⏳</span> Parsing Book...';
    btnAddBook.disabled = true;

    const arrayBuffer = await file.arrayBuffer();
    const bookData = await parseEpub(arrayBuffer);
    const bookId = 'book_' + Date.now();

    await saveBook(bookId, bookData.title, bookData.author, arrayBuffer);
    await loadLibrary();
    await openBook(bookId);
  } catch (err) {
    alert('Failed to parse EPUB: ' + err.message);
    console.error(err);
  } finally {
    btnAddBook.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      Open EPUB Book
    `;
    btnAddBook.disabled = false;
    epubInput.value = '';
  }
}

async function openBook(bookId) {
  const record = await getBookData(bookId);
  if (!record || !record.data) {
    alert('Book data not found');
    return;
  }

  try {
    currentBook = await parseEpub(record.data);
    currentBook.id = bookId;

    // Calculate total pages across entire book
    currentBook.chapterPageCounts = currentBook.chapters.map(ch => 
      Math.max(1, Math.ceil(ch.sentences.length / SENTENCES_PER_PAGE))
    );
    currentBook.totalBookPages = currentBook.chapterPageCounts.reduce((a, b) => a + b, 0);

    headerTitle.textContent = currentBook.title;
    btnChapters.style.display = 'flex';
    topNavArrows.style.display = 'flex';

    buildChapterMenu();

    const prog = await getProgress(bookId);
    currentChapterIndex = Math.min(prog.chapterIndex || 0, currentBook.chapters.length - 1);
    currentPageIndex = prog.sentenceIndex ? Math.floor(prog.sentenceIndex / SENTENCES_PER_PAGE) : 0;

    libraryView.style.display = 'none';
    readerView.style.display = 'block';

    renderPage();
  } catch (err) {
    alert('Error loading book: ' + err.message);
    console.error(err);
  }
}

function showLibrary() {
  stopSpeech();
  closeDrawer();
  currentBook = null;
  readerView.style.display = 'none';
  libraryView.style.display = 'block';
  btnChapters.style.display = 'none';
  topNavArrows.style.display = 'none';
  headerTitle.textContent = 'Kika Reader';
  progressBar.style.width = '0%';
  loadLibrary();
}

function buildChapterMenu() {
  chaptersList.innerHTML = '';
  currentBook.chapters.forEach((ch, idx) => {
    const item = document.createElement('div');
    item.className = 'chapter-item' + (idx === currentChapterIndex ? ' active' : '');
    item.textContent = ch.title;
    item.addEventListener('click', () => {
      currentChapterIndex = idx;
      currentPageIndex = 0;
      renderPage();
      chapterModal.classList.remove('open');
      buildChapterMenu();
      readerView.scrollTop = 0;
      saveProgress(currentBook.id, currentChapterIndex, 0, 0);
    });
    chaptersList.appendChild(item);
  });
}

// --- Bite-sized Pagination Controller with Quiz Trigger ---
function nextPage() {
  if (!currentBook) return;
  const ch = currentBook.chapters[currentChapterIndex];
  const totalPagesInCh = currentBook.chapterPageCounts[currentChapterIndex];

  // 1. Sentences on the page currently being viewed
  const startIdx = currentPageIndex * SENTENCES_PER_PAGE;
  const endIdx = Math.min(startIdx + SENTENCES_PER_PAGE, ch.sentences.length);
  const currentPageSentences = ch.sentences.slice(startIdx, endIdx);

  // Check for yellow "learning" words on this page
  const pageWords = new Set();
  currentPageSentences.forEach(s => {
    tokenizeSentence(s).forEach(t => {
      if (t.type === 'word') pageWords.add(cleanToken(t.text).toLowerCase());
    });
  });

  const yellowOnPage = Object.values(wordTagsMap).filter(t => 
    t.status === 'learning' && pageWords.has(t.word)
  );

  // A. IF QUIZ FREQUENCY IS "EVERY PAGE":
  if (quizEnabled && quizFrequency === 'page' && yellowOnPage.length > 0) {
    pendingNextAction = () => executeAdvancePage();
    startMiniQuiz(yellowOnPage);
    return;
  }

  // B. IF QUIZ FREQUENCY IS "END OF CHAPTER":
  const isLastPageInCh = currentPageIndex >= totalPagesInCh - 1;
  if (quizEnabled && quizFrequency === 'chapter' && isLastPageInCh && currentChapterIndex < currentBook.chapters.length - 1) {
    const chapterWords = new Set();
    ch.sentences.forEach(s => {
      tokenizeSentence(s).forEach(t => {
        if (t.type === 'word') chapterWords.add(cleanToken(t.text).toLowerCase());
      });
    });
    const yellowInChapter = Object.values(wordTagsMap).filter(t => 
      t.status === 'learning' && chapterWords.has(t.word)
    );
    if (yellowInChapter.length > 0) {
      pendingNextAction = () => executeAdvancePage();
      startMiniQuiz(yellowInChapter);
      return;
    }
  }

  executeAdvancePage();
}

function executeAdvancePage() {
  const ch = currentBook.chapters[currentChapterIndex];
  const totalPagesInCh = currentBook.chapterPageCounts[currentChapterIndex];

  if (currentPageIndex < totalPagesInCh - 1) {
    currentPageIndex++;
    renderPage();
    readerView.scrollTop = 0;
    saveProgress(currentBook.id, currentChapterIndex, currentPageIndex * SENTENCES_PER_PAGE, 0);
  } else if (currentChapterIndex < currentBook.chapters.length - 1) {
    currentChapterIndex++;
    currentPageIndex = 0;
    renderPage();
    buildChapterMenu();
    readerView.scrollTop = 0;
    saveProgress(currentBook.id, currentChapterIndex, 0, 0);
  }
}

function prevPage() {
  if (!currentBook) return;

  if (currentPageIndex > 0) {
    currentPageIndex--;
    renderPage();
    readerView.scrollTop = 0;
    saveProgress(currentBook.id, currentChapterIndex, currentPageIndex * SENTENCES_PER_PAGE, 0);
  } else if (currentChapterIndex > 0) {
    currentChapterIndex--;
    const prevTotalPages = currentBook.chapterPageCounts[currentChapterIndex];
    currentPageIndex = prevTotalPages - 1;
    renderPage();
    buildChapterMenu();
    readerView.scrollTop = 0;
    saveProgress(currentBook.id, currentChapterIndex, currentPageIndex * SENTENCES_PER_PAGE, 0);
  }
}

// --- Mini Quiz Implementation ---
async function startMiniQuiz(wordsList) {
  quizCards = wordsList;
  quizCurrentIndex = 0;
  renderCurrentQuizCard();
  quizModal.classList.add('open');
}

async function renderCurrentQuizCard() {
  const card = quizCards[quizCurrentIndex];
  if (!card) {
    finishQuiz();
    return;
  }

  quizProgressText.textContent = `Review Marked Words (${quizCurrentIndex + 1} of ${quizCards.length})`;
  quizWord.textContent = card.original || card.word;

  let contextHtml = escapeHtml(card.contextSentence || '');
  if (contextHtml) {
    const regex = new RegExp(`\\b(${escapeHtml(card.original || card.word)})\\b`, 'gi');
    contextHtml = contextHtml.replace(regex, '<mark>$1</mark>');
    quizContext.innerHTML = `"${contextHtml}"`;
    quizContext.style.display = 'block';
  } else {
    quizContext.style.display = 'none';
  }

  quizAnswerArea.style.display = 'none';
  btnQuizReveal.style.display = 'block';
  quizNextActions.style.display = 'none';

  const tr = await translateWord(card.word);
  if (tr) {
    quizEnAnswer.textContent = tr.en.primary || '—';
    quizEnSyns.textContent = (tr.en.synonyms && tr.en.synonyms.length) ? `Synonyms: ${tr.en.synonyms.join(', ')}` : '';
    quizPlAnswer.textContent = tr.pl.primary || '—';
    quizPlSyns.textContent = (tr.pl.synonyms && tr.pl.synonyms.length) ? `Synonimy: ${tr.pl.synonyms.join(', ')}` : '';
  }
}

function revealQuizAnswer() {
  quizAnswerArea.style.display = 'flex';
  btnQuizReveal.style.display = 'none';
  quizNextActions.style.display = 'flex';
  btnQuizNext.textContent = (quizCurrentIndex >= quizCards.length - 1) ? 'Finish & Continue →' : 'Next Word →';
}

function advanceQuiz() {
  quizCurrentIndex++;
  if (quizCurrentIndex < quizCards.length) {
    renderCurrentQuizCard();
  } else {
    finishQuiz();
  }
}

function finishQuiz() {
  quizModal.classList.remove('open');
  if (pendingNextAction) {
    const action = pendingNextAction;
    pendingNextAction = null;
    action();
  }
}

// --- Rendering Reader Page (Shorter, comfortable page chunks) ---
function renderPage() {
  if (!currentBook || !currentBook.chapters[currentChapterIndex]) return;

  const ch = currentBook.chapters[currentChapterIndex];
  const totalPagesInCh = currentBook.chapterPageCounts[currentChapterIndex];
  currentPageIndex = Math.min(currentPageIndex, totalPagesInCh - 1);

  readerContent.innerHTML = '';

  // Chapter Header (shown on page 1 of chapter)
  if (currentPageIndex === 0) {
    const h = document.createElement('div');
    h.className = 'chapter-header';
    h.textContent = ch.title;
    readerContent.appendChild(h);
  }

  // Slice sentences for the current page
  const startIdx = currentPageIndex * SENTENCES_PER_PAGE;
  const endIdx = Math.min(startIdx + SENTENCES_PER_PAGE, ch.sentences.length);
  const pageSentences = ch.sentences.slice(startIdx, endIdx);

  pageSentences.forEach((sent, localIdx) => {
    const globalSentIdx = startIdx + localIdx;
    const sentBlock = document.createElement('div');
    sentBlock.className = 'sentence-block';
    sentBlock.dataset.sentIdx = globalSentIdx;

    const tokens = tokenizeSentence(sent);
    tokens.forEach(tok => {
      if (tok.type === 'word') {
        const span = document.createElement('span');
        span.className = 'word-token';
        const cleaned = cleanToken(tok.text).toLowerCase();
        span.dataset.word = cleaned;
        span.textContent = tok.text;

        // Apply saved tags if present
        const tag = wordTagsMap[cleaned];
        if (tag) {
          if (tag.status === 'learned') span.classList.add('tag-learned');
          else if (tag.status === 'learning') span.classList.add('tag-learning');
        }
        
        // Multi-tap detection
        span.addEventListener('click', (e) => {
          e.stopPropagation();
          handleWordTap(tok.text, sent, span, sentBlock);
        });

        sentBlock.appendChild(span);
      } else {
        sentBlock.appendChild(document.createTextNode(tok.text));
      }
    });

    // Expand full sentence button with clean bilingual translation icon
    const expandBtn = document.createElement('button');
    expandBtn.className = 'sentence-expand-btn';
    expandBtn.innerHTML = TRANSLATE_ICON_SVG;
    expandBtn.title = 'Translate Sentence';
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSentenceMode(sent, sentBlock);
    });

    sentBlock.appendChild(expandBtn);
    readerContent.appendChild(sentBlock);
  });

  // Calculate Global Page across whole book (Page X of Y)
  let globalPage = 1;
  for (let i = 0; i < currentChapterIndex; i++) {
    globalPage += currentBook.chapterPageCounts[i] || 1;
  }
  globalPage += currentPageIndex;

  const isFirstPage = currentChapterIndex === 0 && currentPageIndex === 0;
  const isLastPage = (currentChapterIndex >= currentBook.chapters.length - 1) && (currentPageIndex >= totalPagesInCh - 1);
  
  btnPrevChapter.disabled = isFirstPage;
  btnNextChapter.disabled = isLastPage;
  btnTopPrev.disabled = isFirstPage;
  btnTopNext.disabled = isLastPage;
  
  pageIndicator.innerHTML = `
    <strong>Page ${globalPage} of ${currentBook.totalBookPages}</strong>
    <span>Chapter ${currentChapterIndex + 1}: ${escapeHtml(ch.title)}</span>
  `;

  updateProgressBar();
}

// --- Multi-Tap Word Handler (Single / Double / Triple) ---
function handleWordTap(rawWord, sentenceText, tokenEl, sentBlock) {
  tapCount++;
  clearTimeout(tapTimer);

  tapTimer = setTimeout(() => {
    if (tapCount === 1) {
      // SINGLE TAP -> Open Word Translation
      openWordMode(rawWord, sentenceText, tokenEl, sentBlock);
    } else if (tapCount === 2) {
      // DOUBLE TAP -> When already tagged (yellow OR green), reverses to neutral!
      // When neutral -> tags as learned (cedar deep green)
      handleDoubleTap(rawWord, sentenceText);
    } else if (tapCount >= 3) {
      // TRIPLE TAP -> Tag as to-learn (warm amber yellow)
      handleTripleTap(rawWord, sentenceText);
    }
    tapCount = 0;
  }, 260);
}

// Double tap: ANY tagged word (yellow OR green) reverses to neutral!
async function handleDoubleTap(rawWord, sentenceText) {
  const word = cleanToken(rawWord).toLowerCase();
  if (!word) return;

  const current = wordTagsMap[word];
  if (current) {
    // Already yellow or green -> reverse to neutral!
    delete wordTagsMap[word];
    await deleteWordTag(word);
    updateWordDomTags(word, null);
  } else {
    // Neutral -> tag as learned (cedar deep green)
    await applyWordTag(word, rawWord, 'learned', sentenceText);
  }
}

// Triple tap: Tag as to-learn (warm amber yellow) or undo if already yellow
async function handleTripleTap(rawWord, sentenceText) {
  const word = cleanToken(rawWord).toLowerCase();
  if (!word) return;

  const current = wordTagsMap[word];
  if (current && current.status === 'learning') {
    // Already yellow -> reverse to neutral
    delete wordTagsMap[word];
    await deleteWordTag(word);
    updateWordDomTags(word, null);
  } else {
    // Neutral or green -> tag as learning (warm amber yellow)
    await applyWordTag(word, rawWord, 'learning', sentenceText);
  }
}

async function applyWordTag(word, rawWord, status, sentenceText) {
  const tagData = {
    word,
    original: cleanToken(rawWord),
    status,
    contextSentence: sentenceText,
    bookId: currentBook ? currentBook.id : '',
  };
  wordTagsMap[word] = tagData;
  await setWordTag(word, status, sentenceText, tagData.bookId);
  updateWordDomTags(word, status);
}

function updateWordDomTags(word, status) {
  document.querySelectorAll(`.word-token[data-word="${word}"]`).forEach(el => {
    el.classList.remove('tag-learned', 'tag-learning');
    if (status === 'learned') el.classList.add('tag-learned');
    else if (status === 'learning') el.classList.add('tag-learning');
  });
}

// --- Translation Drawer Modes ---

// 1. Word Mode (Shows word, TTS, English 1st, Polish 2nd, categories - NO blank sentence)
async function openWordMode(rawWord, sentenceText, tokenEl, sentBlock) {
  const word = cleanToken(rawWord);
  if (!word) return;

  document.querySelectorAll('.word-token.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.sentence-block.active-sentence').forEach(el => el.classList.remove('active-sentence'));

  tokenEl.classList.add('selected');
  sentBlock.classList.add('active-sentence');

  activeWord = word;
  activeSentence = sentenceText;

  // Switch Drawer to Word Mode
  drawerWordMode.style.display = 'block';
  drawerSentenceMode.style.display = 'none';

  trWord.textContent = word;
  trPos.style.display = 'none';
  
  trEnPrimary.innerHTML = '<span class="spinner"></span>';
  trEnSynonyms.textContent = '';
  trEnCategories.innerHTML = '';

  trPlPrimary.innerHTML = '<span class="spinner"></span>';
  trPlSynonyms.textContent = '';
  trPlCategories.innerHTML = '';

  drawer.classList.add('open');

  try {
    const wordRes = await translateWord(word);
    if (wordRes && activeWord === word) {
      // 1. English Results (First)
      trEnPrimary.textContent = wordRes.en.primary || '[No translation]';
      if (wordRes.en.synonyms && wordRes.en.synonyms.length > 0) {
        trEnSynonyms.innerHTML = `<span>Synonyms:</span> ${wordRes.en.synonyms.join(', ')}`;
      }
      renderCategories(wordRes.en.categories, trEnCategories);

      // 2. Polish Results (Second)
      trPlPrimary.textContent = wordRes.pl.primary || '[Brak tłumaczenia]';
      if (wordRes.pl.synonyms && wordRes.pl.synonyms.length > 0) {
        trPlSynonyms.innerHTML = `<span>Synonimy:</span> ${wordRes.pl.synonyms.join(', ')}`;
      }
      renderCategories(wordRes.pl.categories, trPlCategories);

      if (wordRes.pos) {
        trPos.textContent = wordRes.pos;
        trPos.style.display = 'inline-block';
      }
    }
  } catch (err) {
    trEnPrimary.textContent = '[Connection error]';
    trPlPrimary.textContent = '[Błąd połączenia]';
  }
}

// 2. Sentence Mode (ONLY displays the sentence translation - NO blank words, NO wasted space)
async function openSentenceMode(sentenceText, sentBlock = null) {
  document.querySelectorAll('.sentence-block.active-sentence').forEach(el => el.classList.remove('active-sentence'));
  if (sentBlock) sentBlock.classList.add('active-sentence');

  activeWord = '';
  activeSentence = sentenceText;

  // Switch Drawer to Sentence Mode
  drawerWordMode.style.display = 'none';
  drawerSentenceMode.style.display = 'block';

  sentOrigText.textContent = `"${sentenceText}"`;
  sentEnText.innerHTML = '<span class="spinner"></span>';
  sentPlText.innerHTML = '<span class="spinner"></span>';

  drawer.classList.add('open');

  try {
    const sentRes = await translateSentence(sentenceText);
    if (sentRes && activeSentence === sentenceText) {
      sentEnText.textContent = sentRes.en;
      sentPlText.textContent = sentRes.pl;
    }
  } catch (err) {
    sentEnText.textContent = '[Sentence error]';
    sentPlText.textContent = '[Błąd zdania]';
  }
}

function renderCategories(categories, containerEl) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  if (!categories || !categories.length) return;

  categories.forEach(cat => {
    const row = document.createElement('div');
    row.className = 'pos-group';
    row.innerHTML = `
      <span class="pos-tag">${escapeHtml(cat.pos)}</span>
      <span class="pos-synonyms-list">${escapeHtml(cat.synonyms.join(', '))}</span>
    `;
    containerEl.appendChild(row);
  });
}

function closeDrawer() {
  drawer.classList.remove('open');
  document.querySelectorAll('.word-token.selected').forEach(el => el.classList.remove('selected'));
  document.querySelectorAll('.sentence-block.active-sentence').forEach(el => el.classList.remove('active-sentence'));
}

// --- Reading Progress ---
function handleScrollProgress() {
  if (!currentBook) return;
  const maxScroll = readerView.scrollHeight - readerView.clientHeight;
  const scrollPct = maxScroll > 0 ? readerView.scrollTop / maxScroll : 0;
  
  updateProgressBar();
  saveProgress(currentBook.id, currentChapterIndex, currentPageIndex * SENTENCES_PER_PAGE, scrollPct);
}

function updateProgressBar() {
  if (!currentBook || !currentBook.totalBookPages) return;

  let globalPage = 1;
  for (let i = 0; i < currentChapterIndex; i++) {
    globalPage += currentBook.chapterPageCounts[i] || 1;
  }
  globalPage += currentPageIndex;

  const overall = ((globalPage - 1) / currentBook.totalBookPages) * 100;
  progressBar.style.width = Math.min(100, Math.max(0, overall)) + '%';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Start
init();
