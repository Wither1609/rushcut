// Output framing: the rush as it is, or cropped to 9:16 for Reels, TikTok and Shorts.
// The player and the exporter cut the same rectangle out of the rush, so the preview is the export.
import { TEMPLATES } from './templates'
import type { MediaInfo, Project } from './types'

export interface Frame {
  aspect: 'source' | '9:16'
  /** 9:16 only: horizontal position of the crop, 0 = left edge, 0.5 = centre, 1 = right edge. */
  cropX: number
}

/** Part of the rush kept by the frame, in fractions of its width and height. */
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

/** A rush that is not already 9:16 can be shown and exported vertically. */
export const canGoVertical = (m: Pick<MediaInfo, 'width' | 'height'>) => Math.abs(m.width / m.height - 9 / 16) > 0.01

/** Saved framing, or the one the video template asks for (a Reel shot in landscape starts in 9:16). */
export function projectFrame(p: Project): Frame {
  if (p.frame) return p.frame
  const tpl = TEMPLATES.find((t) => t.id === p.brief?.template)
  return { aspect: tpl?.format === '9:16' && p.media.width > p.media.height ? '9:16' : 'source', cropX: 0.5 }
}

/**
 * Same rectangle as the exporter's ffmpeg crop: the widest 9:16 window, moved by cropX; when the rush is
 * narrower than 9:16 the window spans its width and sits at 40 % of the spare height (heads are up there).
 */
export function cropRect(m: Pick<MediaInfo, 'width' | 'height'>, f: Frame): CropRect {
  if (f.aspect !== '9:16') return { x: 0, y: 0, w: 1, h: 1 }
  const w = Math.min(1, (m.height * 9) / 16 / m.width)
  const h = Math.min(1, (m.width * 16) / 9 / m.height)
  return { x: (1 - w) * Math.min(1, Math.max(0, f.cropX)), y: (1 - h) * 0.4, w, h }
}
