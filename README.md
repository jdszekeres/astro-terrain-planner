# astro-terrain-planner

A TypeScript React app that renders a sleek, pannable 360° Three.js night-sky panorama and local terrain profile.

## Features

- Astronomy Engine celestial calculations for current time/location.
- Cesium World Terrain sampling around the observer.
- Interactive 3D panoramic scene with OrbitControls.
- Auto geolocation with polished overlay metadata.

## Local development

```bash
npm install
npm run dev
```

To use Cesium World Terrain, create `.env.local`:

```bash
VITE_CESIUM_ION_TOKEN=your_cesium_ion_token
```
