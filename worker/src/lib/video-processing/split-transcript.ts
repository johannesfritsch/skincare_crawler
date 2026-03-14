import type { TranscriptWord } from './transcribe-audio'

export interface SplitTranscriptResult {
  preTranscript: string
  transcript: string
  postTranscript: string
}

/**
 * Split word-level transcript data into pre/main/post segments for a video scene.
 *
 * @param words - Word-level timestamps from transcription
 * @param sceneStart - Scene start time in seconds
 * @param sceneEnd - Scene end time in seconds
 * @param preSeconds - Seconds of context before scene (default 5)
 * @param postSeconds - Seconds of context after scene (default 3)
 */
export function splitTranscriptForScene(
  words: TranscriptWord[],
  sceneStart: number,
  sceneEnd: number,
  preSeconds: number = 5,
  postSeconds: number = 3,
): SplitTranscriptResult {
  const preWords: string[] = []
  const mainWords: string[] = []
  const postWords: string[] = []

  const preStart = sceneStart - preSeconds

  for (const w of words) {
    // Pre-transcript: words that end within the pre window but before scene start
    if (w.end >= preStart && w.end < sceneStart) {
      preWords.push(w.word)
    }
    // Main transcript: words within the scene range
    else if (w.start >= sceneStart && w.end <= sceneEnd) {
      mainWords.push(w.word)
    }
    // Post-transcript: words that start after scene end but within the post window
    else if (w.start > sceneEnd && w.start <= sceneEnd + postSeconds) {
      postWords.push(w.word)
    }
  }

  return {
    preTranscript: preWords.join(' '),
    transcript: mainWords.join(' '),
    postTranscript: postWords.join(' '),
  }
}
