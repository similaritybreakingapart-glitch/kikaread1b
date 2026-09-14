// On-device Speech Synthesis (TTS) Manager for Android
let deVoice = null;

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  // Find German voice
  deVoice = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('de')) || null;
}

if ('speechSynthesis' in window) {
  loadVoices();
  window.speechSynthesis.onvoiceschanged = loadVoices;
}

export function speakGerman(text) {
  if (!('speechSynthesis' in window) || !text) return;
  
  // Stop current utterance
  window.speechSynthesis.cancel();

  const clean = text.trim();
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = 'de-DE';
  utterance.rate = 0.92; // Slightly slower for language learners
  
  if (deVoice) {
    utterance.voice = deVoice;
  }

  window.speechSynthesis.speak(utterance);
}

export function stopSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}
