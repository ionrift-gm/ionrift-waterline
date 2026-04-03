# Polygon Generation Strategy

> **MANDATORY READING** for any agent working on `WaterDetector.js` contour/polygon generation.
> DO NOT start iterating on polygon algorithms without reading this first.

## Test Scenes

Any polygon generation change MUST be verified against both:

1. **River scene** (Test1): Long, narrow horizontal water body with two separate zones
2. **Coastal scene** (Test2): Large water body covering the right side of the map, with a vertical coastline, piers, and wave breaks

A change that fixes one scene but breaks the other is not acceptable.

## What Works

### Column-sweep (per-column minY/maxY)
- Produces top and bottom edge arrays by scanning each column for the first and last filled cell
- **Works well for rivers** (horizontal water bodies)
- Captures horizontal coastline detail reliably
- **Fails for large coastal bodies** touching scene edges: the top/bottom edges are dominated by flat scene-boundary runs, and RDP flattens the coastline

### Row-sweep (per-row minX/maxX)
- Same approach but scans rows for left/right boundaries
- **Works well for vertical coastlines** (coastal scene)
- Captures vertical coastline detail

### Dual-sweep best-pick (current approach)
- Runs column-sweep and row-sweep independently as complete polygons
- Each sweep simplifies its two edges with RDP independently, then combines them
- **Picks the polygon with more vertices** (more shape detail)
- Rivers: column-sweep wins. Coastlines: row-sweep wins
- No combining/merging of the two sweeps (that causes crossing lines)

## What Does NOT Work

### #traceContour grid-walk + convex hull fallback
- The 8-connected boundary walk fails to traverse all boundary cells for large bodies
- Falls below the 30% coverage threshold and degrades to convex hull
- Convex hull produces rectangular blobs that ignore all concave features
- **Do not use for large water bodies**

### Radial sweep (sort boundary cells by angle from centroid)
- Produces starburst/crossing-line artifacts for concave shapes
- Multiple boundary cells at the same angle (inner coastline + outer scene edge) interleave
- **Not viable for any real-world water shape**

### Single combined contour RDP
- Running RDP on the full combined contour (top+bottom or all 4 edges merged) causes large-scale polygon geometry (the rectangular scene boundaries) to dominate
- Coastline deviations look small relative to the full polygon perimeter
- Results in ~7 vertices regardless of smoothing
- **Always simplify edges independently before combining**

### Combined 4-edge clockwise merge
- Combining all 4 edges (top+right+bottom+left) into one polygon clockwise causes self-intersecting lines
- The edges overlap at corners and the polygon crosses itself, especially for rivers
- **Never merge column-sweep and row-sweep results into one polygon**

## Key Parameters

| Parameter | Range | Impact |
|-----------|-------|--------|
| gridStep | 2-8 | Resolution of the flood fill grid. Lower = more detail but slower. Default: 4 |
| smoothing (RDP tolerance) | 0.5-15 | In grid-cell units. Higher = fewer vertices. Default: 7 |
| tolerance (flood fill) | 5-80 | RGB color distance for flood fill. Higher = more permissive. Default: 40 |

## Refinement Tools

- **Shift+Click**: Adds area to the mask (union via secondary flood fill)
- **Ctrl+Click**: Subtracts area from the mask (difference via secondary flood fill)
- **Ctrl+Z**: Undo last refine operation (mask snapshot stack, max 20)

Refinement modifies the raw cell mask, then re-runs `candidateFromMask()` to regenerate the polygon.
The same tolerance slider value is used for refinement fills.

## Known Limitations (v1)

### Pier/dock cutouts
- The sweep approach only captures outermost boundaries per column/row
- Interior holes (piers, docks removed via Ctrl+Click) don't appear in the polygon
- Pier overlap is cosmetic: pier tokens render above the water shader
- For complex shapes, GMs can manually author Foundry regions

### Shore waves (experimental)
- Shore waves use bounding-box edge distance, not polygon-aware distance
- Waves form straight lines at AABB boundaries, not along the coastline contour
- The continuous-line distortion approach produces weak results
- Default to 0 in all presets; available for experimentation but not v1-quality
- Waves currently flow inward (toward center) instead of toward shore

### Edge fade
- Also uses bounding-box edge distance
- Works acceptably for most shapes but doesn't precisely follow polygon edges

## v2 Roadmap

### SDF texture for polygon-aware edge distance
- Pre-compute a signed distance field texture from the polygon vertices
- Upload as a uniform sampler, sample in the fragment shader
- Replaces bounding-box `edgeDist` with true distance-to-nearest-polygon-edge
- Fixes both edge fade AND shore wave alignment

### Particle-based shore waves
- Replace continuous-line shore wave shader with discrete foam particles
- Emit particles along polygon edge segments
- Each particle: independent lifetime, size, opacity, drift direction
- Produces natural wave crest breakup without needing bounding-box distance
- Dedicated controls: wave speed, frequency, density, breakup

### Vertex drag tool
- Post-accept polygon editing: drag individual vertices on the canvas
- Enables pier cutout without re-detecting
