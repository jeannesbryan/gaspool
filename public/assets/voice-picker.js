/**
 * Voice picker for turn-by-turn guidance (TTS).
 *
 * Why this is separated and tested: the voices do not come from this repo, but
 * from the list the browser and the operating system provide. So what can be
 * fixed is not "the voice" but the WAY OF CHOOSING among the available ones.
 *
 * The previous version used a plain find(): take the first voice whose language
 * starts with "id". That had three consequences, all of them audible to users:
 *
 *   1. If a device provides several Indonesian voices, the one taken was
 *      whichever happened to come first in the system list, which could be a
 *      male voice or a low quality one.
 *   2. If there was NO Indonesian voice at all, the old code set
 *      utterance.lang = "id-ID" with no voice. The browser then used its own
 *      default voice, usually English, to pronounce Indonesian words. That is
 *      what sounds like a "bad Indonesian accent": it is not an Indonesian
 *      accent at all, it is an English pronunciation of Indonesian words.
 *   3. There was no way for the user to choose, even though their ears are
 *      the ones that best know what sounds pleasant.
 *
 * This file is a plain .js in public/assets so TWO places can use it without
 * copying: the tracker page and tests/voice-picker.mjs.
 */

/** The most suitable languages, ordered from best to worst. */
const LANGUAGE_RANK = [
  { prefix: "id", score: 100 },
  { prefix: "ms", score: 55 }, // Melayu: pelafalan Latin yang dekat
  { prefix: "jv", score: 40 }, // Jawa: sering tersedia dan terdengar akrab
];

/** Quality markers in the voice name. */
const QUALITY_MARKERS = [
  { token: "natural", score: 30 },
  { token: "neural", score: 28 },
  { token: "google", score: 22 },
  { token: "microsoft", score: 18 },
  { token: "siri", score: 16 },
  { token: "premium", score: 14 },
  { token: "enhanced", score: 12 },
];

/**
 * Markers of a female voice.
 *
 * This is not a matter of taste: guidance is read out while riding, and a
 * female voice is generally easier to pick out of road noise in the frequency
 * range being used. Users also asked for it explicitly.
 */
const FEMALE_MARKERS = [
  { token: "female", score: 26 },
  { token: "wanita", score: 26 },
  { token: "perempuan", score: 26 },
  { token: "gadis", score: 24 },
  { token: "damayanti", score: 24 },
  { token: "siti", score: 20 },
  { token: "dewi", score: 20 },
  { token: "putri", score: 20 },
  { token: "ayu", score: 18 },
  { token: "zira", score: 18 },
  { token: "aria", score: 16 },
  { token: "jenny", score: 16 },
  { token: "female_", score: 26 },
];

/** Markers of a male voice: penalised, not banned, since it is still better
 *  than pronouncing Indonesian words with an English voice. */
const MALE_MARKERS = [
  { token: "male", score: -30 },
  { token: "pria", score: -30 },
  { token: "andika", score: -26 },
  { token: "ardi", score: -26 },
  { token: "budi", score: -24 },
  { token: "david", score: -22 },
  { token: "mark", score: -20 },
];

/** Low quality markers that are better avoided. */
const LOW_QUALITY_MARKERS = [
  { token: "compact", score: -18 },
  { token: "espeak", score: -40 },
  { token: "pico", score: -14 },
  { token: "low", score: -16 },
];

const normalize = (value) => String(value || "").toLowerCase();

/**
 * Score one voice. The higher the better.
 * Exported so it can be checked directly in a test, not only through ordering.
 */
export function scoreVoice(voice) {
  if (!voice) return Number.NEGATIVE_INFINITY;

  const lang = normalize(voice.lang).replace("_", "-");
  const name = normalize(voice.name);

  let score = 0;

  const language = LANGUAGE_RANK.find((entry) => lang.startsWith(entry.prefix));
  if (language) {
    score += language.score;
  } else if (lang) {
    // It has a language, just not one of the fits. It can still be used as a
    // last resort, so the score is low but not impossible.
    score -= 40;
  } else {
    // No language information at all: there is no basis to judge it, so it
    // must never win while a voice with a clear language exists.
    score -= 100;
  }

  for (const marker of QUALITY_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }
  for (const marker of FEMALE_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }
  for (const marker of MALE_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }
  for (const marker of LOW_QUALITY_MARKERS) {
    if (name.includes(marker.token)) score += marker.score;
  }

  // A local voice needs no network, so it does not drop out when the signal
  // goes: important for turn-by-turn guidance on the road.
  if (voice.localService) score += 8;
  if (voice.default) score += 2;

  return score;
}

/**
 * Sort the voice list from the best fit.
 * Returns a new array; the original list is not modified.
 */
export function rankVoices(voices) {
  const list = Array.isArray(voices) ? voices.filter(Boolean) : [];

  return list
    .map((voice, index) => ({ voice, index, score: scoreVoice(voice) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Keep the order when scores are equal, so the result is predictable.
      return a.index - b.index;
    })
    .map((entry) => entry.voice);
}

/**
 * Whether this voice really speaks Indonesian.
 * Used to tell the user that their device has no Indonesian voice, even though
 * turn-by-turn guidance may still work using the closest related language
 * available.
 */
export function isIndonesianVoice(voice) {
  const lang = normalize(voice && voice.lang).replace("_", "-");
  return lang.startsWith("id");
}

/**
 * Whether this voice is fit to read Indonesian words aloud.
 *
 * Malay and Javanese are accepted too, and that is a conscious decision: they
 * belong to the same family as Indonesian, so "belok kiri" and "tujuh ratus
 * meter" sound almost the same. What is not fit is an English voice and the
 * like, because pronouncing Indonesian words with English phonetics is exactly
 * what makes the guidance sound strange.
 *
 * To be clear: "not fit" does NOT mean the app then stays silent. Guidance
 * that disappears without explanation is far more dangerous on the road than
 * guidance that sounds strange. That is why the caller still reads the
 * instruction out, while the screen tells the user that this device has no
 * Indonesian voice yet and offers a way to change that. What this picker does
 * is make sure the best voice that EXISTS is actually used, not whichever one
 * happens to be first in the system list.
 */
export function isAcceptableVoice(voice) {
  const lang = normalize(voice && voice.lang).replace("_", "-");
  return LANGUAGE_RANK.some((entry) => lang.startsWith(entry.prefix));
}

/**
 * Pick a voice for turn-by-turn guidance.
 *
 * `preferredName` is the user's previously saved choice. That choice is
 * honoured as long as the voice is still available: a device can lose a voice
 * after a system update, and a choice that has gone must not make the whole
 * pick fail.
 */
export function pickBestVoice(voices, preferredName) {
  const ranked = rankVoices(voices);
  if (ranked.length === 0) return null;

  const wanted = String(preferredName || "");
  if (wanted) {
    const chosen = ranked.find((voice) => voice.name === wanted);
    if (chosen) return chosen;
  }

  const best = ranked[0];
  // If even the best one is not fit (for example the whole device only has
  // English voices), staying silent is better: turn-by-turn guidance
  // pronounced with a foreign accent is more confusing than having no
  // guidance at all.
  if (!isAcceptableVoice(best)) {
    return ranked.find(isAcceptableVoice) || null;
  }

  return best;
}

/** Short summary to show on screen. */
export function describeVoice(voice) {
  if (!voice) return "TIDAK ADA SUARA INDONESIA";
  const name = String(voice.name || "").replace(/^(Google|Microsoft)\s*/i, "");
  return name + " · " + String(voice.lang || "");
}
