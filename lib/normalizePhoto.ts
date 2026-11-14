import sharp from 'sharp'
import { HttpError } from '../httpError.js'

sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer', 'VipsForeignLoadWebpBuffer', 'VipsForeignLoadHeifBuffer'] })

const maxInputPixels = 25_000_000
const maxStoredBytes = 5 * 1024 * 1024
const maxConcurrentDecodes = 2
let activeDecodes = 0

function identify(bytes: Buffer) {
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'jpeg'
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (bytes.toString('ascii', 4, 8) === 'ftyp' &&
    ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(bytes.toString('ascii', 8, 12))) return 'heif'
  return null
}

export async function normalizePhoto(bytes: Buffer, purpose: 'store' | 'analyze') {
  const format = identify(bytes)
  const invalid = () => new HttpError(415, 'Choose a valid JPEG, PNG, WebP or supported HEIC image')
  if (!format) throw invalid()
  if (activeDecodes >= maxConcurrentDecodes) throw new HttpError(429, 'Photo processing is busy. Try again shortly.')
  activeDecodes++
  try {
    const image = sharp(bytes, { limitInputPixels: maxInputPixels, failOn: 'warning' })
    const metadata = await image.metadata()
    if (metadata.format !== format || !metadata.width || !metadata.height ||
      metadata.width * metadata.height > maxInputPixels) throw invalid()

    const size = purpose === 'analyze' ? 768 : 2048
    const output = image.autoOrient().resize(size, size, { fit: 'inside', withoutEnlargement: true }).timeout({ seconds: 8 })
    // Encoding removes source metadata by default. Keep transparency for ordinary PNG/WebP uploads.
    if (purpose === 'store' && (format === 'png' || format === 'webp')) {
      const data = await output.clone().toFormat(format).toBuffer()
      if (data.length <= maxStoredBytes) return { data, ext: format, contentType: `image/${format}` }
    }
    const data = await output.flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer()
    return { data, ext: 'jpg', contentType: 'image/jpeg' }
  } catch {
    throw invalid()
  } finally {
    activeDecodes--
  }
}
