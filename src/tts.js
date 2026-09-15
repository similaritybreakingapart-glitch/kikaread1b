import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { Capacitor } from '@capacitor/core';

const LANG = 'de-DE';
const RATE = 0.95;

/**
 * Speak German text.
 * Uses native Android TextToSpeech engine on mobile (Capacitor),
 * and standard Web Speech API as fallback in regular browsers.
 */
export async function speakGerman(text) {
  if (!text) return;
  const clean = text.trim();
  if (!clean) return;

  try {
    if (Capacitor.isNativePlatform()) {
      // Native Android TextToSpeech (via Google Speech Services)
      await TextToSpeech.stop().catch(() => {});
      await TextToSpeech.speak({
        text: clean,
        lang: LANG,
        rate: RATE,
        pitch: 1.0,
        volume: 1.0,
        category: 'ambient',
      });
    } else {
      // Web browser fallback
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(clean);
        utt.lang = LANG;
        utt.rate = RATE;
        const voices = window.speechSynthesis.getVoices();
        const de = voices.find(v => v.lang && v.lang.toLowerCase().startsWith('de'));
        if (de) utt.voice = de;
        window.speechSynthesis.speak(utt);
      }
    }
  } catch (err) {
    console.error('[TTS] speakGerman error:', err);
  }
}

/**
 * Stop any ongoing speech playback.
 */
export async function stopSpeech() {
  try {
    if (Capacitor.isNativePlatform()) {
      await TextToSpeech.stop().catch(() => {});
    } else if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (err) {
    console.error('[TTS] stopSpeech error:', err);
  }
}
