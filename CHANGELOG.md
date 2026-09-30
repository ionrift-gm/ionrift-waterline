# Changelog

## [1.0.0] - 2026-09-30

### Added
- Fluid Archetypes: dedicated simulation profiles for Oceans, Coastlines, Rivers, Lakes, Ponds, and Puddles.
- Auto estimation: evaluates new water bodies to assign an archetype and flow heading from geometry.
- Ocean shader with deep sea chop and wave simulations.
- Shoreline shader with surf wash, swash reach, and beach foam.
- River, lake, pond, and puddle shaders with directional cellular flow and reflective swells.
- Modular integration hooks for external modules and systems.

### Removed
- Procedural border walls moved to Ionrift Cartographer.

## [0.2.8] - 2026-09-22

### Restored
- Procedural border wall generation.

## [0.2.7] - 2026-09-22

### Fixed
- Water regions now render at their defined elevation on multi-level maps instead of defaulting to the ground level.
- Token wake ripples now respect scene level elevations and no longer trigger across different floors.

### Removed
- Procedural border wall generation has moved to the Ionrift Cartographer module.

## [0.2.6] - 2026-07-14

### Changed
- Package listing no longer links YouTube demos.
- Package listing uses Foundry's default module icon.

## [0.2.5] - 2026-07-14

### Changed
- Release package no longer includes development tooling files.

## [0.2.4] - 2026-05-29

### Fixed
- Water region behaviors now survive Foundry v14 world upgrades. Previously, the behavior type registered too late and v14's stricter validation would silently drop water effects from scenes during migration.
- Compatibility declared for Foundry v14.

## [0.2.3] - 2026-05-26

### Changed
- Token wake and debug settings moved behind the tuning dialog. The Game Settings list is cleaner.

## [0.2.2] - 2026-05-03

### Added
- **Wake wobble.** Token ripples now feature an organic wobble effect. The wake tuning panel includes new sliders for wobble amplitude and lobe count to create more dynamic ripple shapes.

### Fixed
- Token ripples no longer appear when a token is hidden from players by the GM.

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
