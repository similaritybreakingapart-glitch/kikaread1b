// On-device Speech Synthesis (TTS) Manager for Android WebView (Capacitor)
//
// Android WebView TTS quirks addressed here:
//  1. onvoiceschanged fires late or never — lazy voice resolution at speak time
//  2. Long utterances (>200 chars) silently fail — chunk by sentence
//  3. WebView pauses synthesis when backgrounded — periodic resume() keepalive
//  4. speak() must follow a cancel() with a short delay to avoid queue issues

const LANG = 'de-DE';
const RATE = 0.92;

// Keepalive interval handle — prevents Android WebView from silently stopping TTS
let _keepaliveTimer = null;

function _startKeepalive() {
  _stopKeepalive();
  _keepaliveTimer = setInterval(() => {
    if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.pause();
      window.speechSynthesis.resume();
    }
  }, 10000); // Every 10s
}

function _stopKeepalive() {
  if (_keepaliveTimer !== null) {
    clearInterval(_keepaliveTimer);
    _keepaliveTimer = null;
  }
}

/**
 * Resolve the best German voice at call time.
 * Prefers a local (not remote) voice to avoid network dependency.
 */
function _resolveVoice() {
  if (!('speechSynthesis' in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const german = voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('de'));
  if (!german.length) return null;

  // Prefer local voices (more reliable in Android WebView)
  return german.find(v => v.localService) || german[0];
}

/**
 * Split text into sentences so each chunk stays under the Android WebView limit.
 * Splits on ". ", "! ", "? " and keeps the delimiter.
 */
function _splitSentences(text) {
  const max = 180; // Safe chunk size for Android WebView
  if (text.length <= max) return [text];

  const raw = text.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = '';

  for (const s of raw) {
    if ((current + s).length > max && current) {
      chunks.push(current.trim());
      current = s;
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

/**
 * Speak a list of chunks sequentially.
 */
function _speakChunks(chunks, index = 0) {
  if (!('speechSynthesis' in window) || index >= chunks.length) {
    _stopKeepalive();
    return;
  }

  const utt = new SpeechSynthesisUtterance(chunks[index]);
  utt.lang = LANG;
  utt.rate = RATE;

  const voice = _resolveVoice();
  if (voice) {
    utt.voice = voice;
    utt.lang = voice.lang; // Use exact lang from voice
  }

  utt.onend = () => {
    _speakChunks(chunks, index + 1);
  };

  utt.onerror = (e) => {
    // 'canceled' is expected when stopSpeech() is called — ignore it
    if (e.error !== 'canceled') {
      console.warn('[TTS] Error on chunk', index, e.error);
    }
    _stopKeepalive();
  };

  window.speechSynthesis.speak(utt);
}

/**
 * Speak German text.
 * Call this only from a user gesture handler (click, tap) for Android compliance.
 */
export function speakGerman(text) {
  if (!('speechSynthesis' in window) || !text) return;

  const clean = text.trim();
  if (!clean) return;

  // Cancel any ongoing speech first, then delay to let WebView flush its queue
  window.speechSynthesis.cancel();

  setTimeout(() => {
    const chunks = _splitSentences(clean);
    _startKeepalive();
    _speakChunks(chunks, 0);
  }, 50);
}

export function stopSpeech() {
  _stopKeepalive();
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
