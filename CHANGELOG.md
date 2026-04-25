# Changelog

## [0.2.1] - 2026-04-25

### Fixed
- Ripples no longer reappear at old positions when multiple tokens share the shader budget. Displaced ripples now fade out gracefully instead of vanishing and resurfacing.

## [0.2.0] - 2026-04-25

### Token Water Wake
- **Ripple rings.** Tokens moving through water regions emit expanding concentric ripples - visible as shader distortion on the water surface.
- **Idle ripples.** Tokens standing still in water produce gentle ambient ripples at random intervals.
- **Multi-token support.** Shader slots are distributed fairly when multiple tokens are in water at the same time.
- **Per-token opt-out.** Disable ripples for individual tokens via the noRipple flag in Token Config.
- **Elevated tokens.** Tokens with elevation above 0 (flying, climbing) skip the water wake entirely.
- **Wake Tuning panel.** GM-only dialog with live sliders for ripple shape, timing, variance, and shader parameters. Save and load presets per world.

### Changed
- Minimum Foundry version raised to V13.

## 0.1.0 - Initial Release

### Water FX
- Flood-fill water detection with adjustable tolerance and smoothing
- Dual-sweep polygon generation for rivers and coastlines
- Animated PIXI shaders: Voronoi caustics, background distortion, edge fade
- Flow direction control (0-360 degrees)
- Built-in presets: River, Lake, Puddle, Coast, Deep Sea
- Custom preset save/load per world
- Live slider preview with real-time shader updates
- Shift+Click to add area, Ctrl+Click to subtract, Ctrl+Z to undo
- Automatic water color sampling from the map background
- Region behavior integration (Ionrift: Water FX type)

### Border Walls
- Procedural noise-based wall generation along canvas edges
- Straight-wall mode for clean boundaries
- Configurable vertex count, amplitude, jitter, and inset
