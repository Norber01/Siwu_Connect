/**
 * Makes phone videos smaller before upload: re-encodes to at most 720p H.264 MP4 with the
 * index at the front ("fast start"), so it uploads faster and starts playing sooner.
 * Uses the phone's built-in video encoder (WebCodecs). If the phone can't do it, or the
 * result isn't smaller, the original file is used.
 */
export async function compressVideo(
  file: File,
  info: { width: number; height: number },
  onProgress: (fraction: number) => void,
  opts: { maxSide?: number; light?: boolean } = {},
): Promise<{ blob: Blob; type: string; width: number; height: number }> {
  const maxSide = opts.maxSide ?? 1280;
  const original = { blob: file as Blob, type: file.type, width: info.width, height: info.height };
  const longSide = Math.max(info.width, info.height);
  // Already small: nothing to gain.
  if (!opts.light && file.size < 4 * 1024 * 1024 && longSide <= maxSide) return original;
  if (opts.light && longSide <= maxSide) return original;
  if (typeof window === 'undefined' || !('VideoEncoder' in window)) return original;
  try {
    const mb = await import('mediabunny');
    const input = new mb.Input({ formats: mb.ALL_FORMATS, source: new mb.BlobSource(file) });
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
    const scale = longSide > maxSide ? maxSide / longSide : 1;
    const width = Math.round((info.width * scale) / 2) * 2;
    const height = Math.round((info.height * scale) / 2) * 2;
    const landscape = info.width >= info.height;
    const conversion = await mb.Conversion.init({
      input,
      output,
      video: {
        ...(scale < 1 ? (landscape ? { width } : { height }) : {}),
        codec: 'avc',
        quality: opts.light ? mb.QUALITY_LOW : mb.QUALITY_MEDIUM,
        forceTranscode: true,
        frameRate: 30,
      },
      audio: { codec: 'aac', quality: opts.light ? mb.QUALITY_LOW : mb.QUALITY_MEDIUM },
    });
    if (!conversion.isValid) return original;
    conversion.onProgress = (p) => onProgress(p);
    await conversion.execute();
    const buf = target.buffer;
    if (!buf || buf.byteLength === 0 || buf.byteLength >= file.size * 0.9) return original;
    return { blob: new Blob([buf], { type: 'video/mp4' }), type: 'video/mp4', width: width || info.width, height: height || info.height };
  } catch {
    return original;
  }
}
