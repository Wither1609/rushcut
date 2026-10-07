import fs from 'fs'
import path from 'path'
import { getSettings } from './store'
import type { Word } from '../shared/types'

interface ScribeWord {
  text: string
  start: number
  end: number
  type: 'word' | 'spacing' | 'audio_event'
}

/** Word-level transcription with ElevenLabs Scribe. Runs in the cloud: no local CPU. */
export async function transcribe(audioFile: string, signal?: AbortSignal): Promise<Word[]> {
  const { elevenKey, scribeModel } = getSettings()
  if (!elevenKey) throw new Error('Ajoute ta clé ElevenLabs dans Réglages pour lancer la transcription.')
  const form = new FormData()
  form.append('model_id', scribeModel || 'scribe_v2')
  form.append('timestamps_granularity', 'word')
  form.append('tag_audio_events', 'false')
  form.append('file', new Blob([fs.readFileSync(audioFile)], { type: 'audio/mpeg' }), path.basename(audioFile))
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': elevenKey },
    body: form,
    signal
  })
  if (!res.ok) {
    const body = await res.text()
    if (res.status === 401) throw new Error('Clé ElevenLabs refusée. Vérifie-la dans Réglages.')
    throw new Error(`ElevenLabs a répondu ${res.status} : ${body.slice(0, 300)}`)
  }
  const j = (await res.json()) as { words?: ScribeWord[] }
  return (j.words ?? [])
    .filter((w) => w.type === 'word' && w.text.trim())
    .map((w) => ({ text: w.text.trim(), start: w.start, end: w.end }))
}
