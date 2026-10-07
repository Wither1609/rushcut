// Playback clock outside React: the playhead, the transcript highlight and the timecode
// update imperatively, so a playing video re-renders only the motion-design overlay.
type Fn = (t: number) => void

class Clock {
  t = 0
  playing = false
  private subs = new Set<Fn>()
  private playSubs = new Set<(p: boolean) => void>()
  seekImpl: (t: number) => void = () => {}

  set(t: number) {
    this.t = t
    for (const f of this.subs) f(t)
  }
  seek(t: number) {
    this.seekImpl(t)
  }
  setPlaying(p: boolean) {
    this.playing = p
    for (const f of this.playSubs) f(p)
  }
  subscribe(f: Fn) {
    this.subs.add(f)
    return () => void this.subs.delete(f)
  }
  onPlaying(f: (p: boolean) => void) {
    this.playSubs.add(f)
    return () => void this.playSubs.delete(f)
  }
}

export const clock = new Clock()
