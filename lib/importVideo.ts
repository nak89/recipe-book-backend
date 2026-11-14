import { BufferSource, Input, MP4, WEBM } from 'mediabunny'
import { HttpError } from '../httpError.js'

const maxDurationSeconds = 180

export async function inspectImportVideo(bytes: Buffer): Promise<{ format: 'mp4' | 'webm'; hasAudio: boolean }> {
  const input = new Input({ formats: [MP4, WEBM], source: new BufferSource(bytes) })
  try {
    const format = await input.getFormat()
    if (!await input.getPrimaryVideoTrack()) throw new HttpError(415, 'Choose an MP4 or WebM video')
    const duration = await input.computeDuration(undefined, { skipLiveWait: true })
    if (!Number.isFinite(duration) || duration <= 0) throw new HttpError(415, 'Could not read the video duration')
    if (duration > maxDurationSeconds) throw new HttpError(413, 'Choose a video up to 3 minutes, or paste its caption')
    return { format: format === WEBM ? 'webm' : 'mp4', hasAudio: !!await input.getPrimaryAudioTrack() }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(415, 'Choose a valid MP4 or WebM video')
  } finally {
    input.dispose()
  }
}
