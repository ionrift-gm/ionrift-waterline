# Ionrift Waterline

![Downloads](https://img.shields.io/github/downloads/ionrift-gm/ionrift-waterline/latest/total?color=violet&label=Downloads)
![Latest Release](https://img.shields.io/github/v/release/ionrift-gm/ionrift-waterline?color=violet&label=Latest%20Version)
![Foundry Version](https://img.shields.io/badge/Foundry-v12%20%7C%20v13-333333?style=flat&logo=foundryvirtualtabletop)
![Systems](https://img.shields.io/badge/systems-dnd5e%20%7C%20daggerheart-blue)

**Animated water overlays and procedural border walls for Foundry VTT.**

### Support Ionrift

[![Patreon](https://img.shields.io/badge/Patreon-ionrift-ff424d?logo=patreon&logoColor=white)](https://patreon.com/ionrift)
[![Discord](https://img.shields.io/badge/Discord-Ionrift-5865F2?logo=discord&logoColor=white)](https://discord.gg/vFGXf7Fncj)

> Documentation, setup guides, and troubleshooting: **[Ionrift Wiki](https://github.com/ionrift-gm/ionrift-library/wiki)**

[![Watch the demo](https://img.youtube.com/vi/USmx-8CmQGk/maxresdefault.jpg)](https://youtu.be/USmx-8CmQGk)

## Water FX

Click on water in your map and Waterline traces the shape automatically using flood-fill detection. It then renders a live animated overlay with Voronoi caustics, background distortion, and configurable edge fade.

You can tune everything with sliders that update in real time: speed, intensity, opacity, distortion, scale, and flow direction. Built-in presets (River, Lake, Puddle, Coast, Deep Sea) set sensible defaults, and you can save your own per-world profiles.

Shift+Click adds area. Ctrl+Click subtracts. Ctrl+Z undoes the last change.

## Border Walls

Procedural wall generation along the canvas boundary with noise-based variation. Set vertex count, amplitude, jitter, and inset, then generate. Straight-wall mode also available.

## Installation

1. Install via Foundry VTT Module Browser or manifest URL.
2. Enable the module in your world.
3. Water tools appear in the Regions palette. Border tools appear in the Walls palette.

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
