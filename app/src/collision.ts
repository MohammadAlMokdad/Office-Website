// 2D collision in the office's floor plan (Blender plan coordinates, metres): the walker is a circle that must stay
// inside the room outline and outside every furniture footprint (convex polygons exported from Blender).
import data from './data/collision.json'

export type Pt = { x: number; y: number }
type Obstacle = { poly: Pt[]; minX: number; maxX: number; minY: number; maxY: number }

const toPts = (a: number[][]): Pt[] => a.map(([x, y]) => ({ x, y }))

function closestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return { x: a.x + t * dx, y: a.y + t * dy }
}

function inside(p: Pt, poly: Pt[]): boolean {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c
  }
  return c
}

function closestOnBoundary(p: Pt, poly: Pt[]): Pt {
  let best = poly[0], bd = Infinity
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length])
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2
    if (d < bd) { bd = d; best = q }
  }
  return best
}

export class Collider {
  readonly radius = data.radius
  readonly eye = data.floor + data.eye // three.js y of the eye (the floor is not at 0)
  readonly spawn = { x: data.spawn.pos[0], y: data.spawn.pos[1] }
  look = { x: data.spawn.look[0], y: data.spawn.look[1] }
  private room = toPts(data.room)
  private obstacles: Obstacle[] = data.obstacles.map((o) => {
    const poly = toPts(o.poly)
    return {
      poly,
      minX: Math.min(...poly.map((p) => p.x)), maxX: Math.max(...poly.map((p) => p.x)),
      minY: Math.min(...poly.map((p) => p.y)), maxY: Math.max(...poly.map((p) => p.y)),
    }
  })

  /** Moves p out of walls and furniture (a few relaxation passes so corners slide nicely). */
  resolve(p: Pt): Pt {
    const r = this.radius
    let q = { ...p }
    for (let pass = 0; pass < 4; pass++) {
      // room outline: stay inside, keep r away from every wall
      if (!inside(q, this.room)) {
        const c = closestOnBoundary(q, this.room)
        const cx = this.room.reduce((s, v) => s + v.x, 0) / this.room.length, cy = this.room.reduce((s, v) => s + v.y, 0) / this.room.length
        const l = Math.hypot(cx - c.x, cy - c.y) || 1
        q = { x: c.x + ((cx - c.x) / l) * r, y: c.y + ((cy - c.y) / l) * r }
      }
      for (let i = 0; i < this.room.length; i++) {
        const c = closestOnSegment(q, this.room[i], this.room[(i + 1) % this.room.length])
        const dx = q.x - c.x, dy = q.y - c.y, d = Math.hypot(dx, dy)
        if (d < r && d > 1e-6) { q.x += (dx / d) * (r - d); q.y += (dy / d) * (r - d) }
      }
      // furniture
      for (const o of this.obstacles) {
        if (q.x < o.minX - r || q.x > o.maxX + r || q.y < o.minY - r || q.y > o.maxY + r) continue
        const c = closestOnBoundary(q, o.poly)
        const dx = q.x - c.x, dy = q.y - c.y, d = Math.hypot(dx, dy)
        if (inside(q, o.poly)) {
          const l = d || 1
          q = { x: c.x - (dx / l) * r, y: c.y - (dy / l) * r }
        } else if (d < r && d > 1e-6) {
          q.x += (dx / d) * (r - d); q.y += (dy / d) * (r - d)
        }
      }
    }
    return q
  }
}
