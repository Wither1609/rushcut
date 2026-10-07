import type { Shape } from '../../shared/types'

export const INK_COLORS = ['#ef4444', '#facc15', '#3b82f6', '#ffffff']

export function drawShape(ctx: CanvasRenderingContext2D, s: Shape, W: number, H: number) {
  const lw = Math.max(2, W * 0.005)
  ctx.save()
  ctx.lineWidth = lw
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = s.color
  ctx.shadowColor = 'rgba(0,0,0,.45)'
  ctx.shadowBlur = lw * 1.5
  ctx.beginPath()
  if (s.tool === 'pen') {
    const pts = s.pts ?? []
    if (pts.length < 2) return ctx.restore()
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H)))
  } else if (s.a && s.b) {
    const [x1, y1] = [s.a[0] * W, s.a[1] * H]
    const [x2, y2] = [s.b[0] * W, s.b[1] * H]
    if (s.tool === 'rect') ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1))
    else if (s.tool === 'ellipse') ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
    else if (s.tool === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1)
      const hl = Math.max(lw * 5, Math.min(W * 0.03, Math.hypot(x2 - x1, y2 - y1) * 0.4))
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.moveTo(x2 - hl * Math.cos(ang - 0.5), y2 - hl * Math.sin(ang - 0.5))
      ctx.lineTo(x2, y2)
      ctx.lineTo(x2 - hl * Math.cos(ang + 0.5), y2 - hl * Math.sin(ang + 0.5))
    }
  }
  ctx.stroke()
  ctx.restore()
}

export function shapeIsUsable(s: Shape) {
  if (s.tool === 'pen') return (s.pts?.length ?? 0) > 2
  return !!s.a && !!s.b && Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 0.01
}
