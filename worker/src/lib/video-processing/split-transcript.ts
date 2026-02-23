import type { TranscriptWord } from './transcribe-audio'

export interface SplitTranscriptResult {
  preTranscript: string
  transcript: string
  postTranscript: string
}

/**
 * Split word-level transcript data into pre/main/post segments for a video snippet.
 *
 * @param words - Word-level timestamps from transcription
 * @param snippetStart - Snippet start time in seconds
 * @param snippetEnd - Snippet end time in seconds
 * @param preSeconds - Seconds of context before snippet (default 5)
 * @param postSeconds - Seconds of context after snippet (default 3)
 */
export function splitTranscriptForSnippet(
  words: TranscriptWord[],
  snippetStart: number,
  snippetEnd: number,
  preSeconds: number = 5,
  postSeconds: number = 3,
): SplitTranscriptResult {
  const preWords: string[] = []
  const mainWords: string[] = []
  const postWords: string[] = []

  const preStart = snippetStart - preSeconds

  for (const w of words) {
    // Pre-transcript: words that end within the pre window but before snippet start
    if (w.end >= preStart && w.end < snippetStart) {
      preWords.push(w.word)
    }
    // Main transcript: words within the snippet range
    else if (w.start >= snippetStart && w.end <= snippetEnd) {
      mainWords.push(w.word)
    }
    // Post-transcript: words that start after snippet end but within the post window
    else if (w.start > snippetEnd && w.start <= snippetEnd + postSeconds) {
      postWords.push(w.word)
    }
  }

  return {
    preTranscript: preWords.join(' '),
    transcript: mainWords.join(' '),
    postTranscript: postWords.join(' '),
  }
}
