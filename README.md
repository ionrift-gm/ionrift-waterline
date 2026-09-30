# Ionrift Waterline

![Downloads](https://img.shields.io/github/downloads/ionrift-gm/ionrift-waterline/total?color=violet&label=Downloads)
![Latest Release](https://img.shields.io/github/v/release/ionrift-gm/ionrift-waterline?color=violet&label=Latest%20Version)
![Foundry Version](https://img.shields.io/badge/Foundry-v13%20%7C%20v14-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/systems-all-blue)

**Animated water shaders and fluid dynamics for Foundry VTT.**

> Documentation, setup guides, and troubleshooting: **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)**

Waterline renders animated procedural shaders directly onto Foundry VTT scenes with live-tunable currents, waves, and caustics. Built on native scene Regions, it analyzes polygon geometry to auto-detect fluid archetypes and applies calibrated shaders with zero manual vertex fiddling.

## Features

- **Six Tabletop Fluid Archetypes:** Dedicated simulation models for Oceans, Coastlines, Rivers, Lakes, Ponds, and Puddles.
- **Directional Current & Cellular Swells:** River flow follows channel headings with organic, non-repeating wavelet packets and turbulent riffles.
- **Breaking Surf & Swash:** Coastal shores break with forward crest bow curvature and retreating foam backwash.
- **Wind Ruffles & Concentric Ripples:** Lakes and inland tarns feature asymmetric bank undulation, gentle breeze ruffles, and rain drop oscillators.
- **Map Eyedropper Sampling:** Sample pixel colors directly from canvas battlemaps to match water tints to any cartography, or dial in fantasy fluids (acid pools, blood tarns, murky bayous).
- **Reactive Token Wakes:** Moving tokens emit expanding wake ripples that respect vertical elevation bounds (flying tokens above water produce no wake). Per-token suppression toggle supported on the token sheet.
- **Multi-Region Batch Tuning:** Adjust wave speed, foam, or height across all matching water bodies on the scene in lockstep.

## Installation

1. Install via Foundry VTT Module Browser or manifest URL.
2. Enable the module in your world.
3. Open the **Regions** palette on the left canvas controls and click the **Waterline** tool (`fas fa-water`) to inspect, estimate, and tune water regions.

## Dependencies

- **[Ionrift Library](https://github.com/ionrift-gm/ionrift-library)** (required)

## Bug Reports

1. Check the **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)** for common fixes.
2. Post to the **[Ionrift Discord](https://discord.gg/vFGXf7Fncj)** with Foundry version, module versions, and any console errors (F12).
3. Open a **[GitHub Issue](https://github.com/ionrift-gm/ionrift-waterline/issues)**.

## License

MIT License. See [LICENSE](./LICENSE) for details.

---

**Part of the [Ionrift Module Suite](https://github.com/ionrift-gm)**

[Wiki](https://github.com/ionrift-gm/ionrift-library/wiki) · [Discord](https://discord.gg/vFGXf7Fncj) · [Patreon](https://patreon.com/ionrift)
