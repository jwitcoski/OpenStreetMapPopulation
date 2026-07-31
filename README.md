# BuildingPop

**Live app:** [https://jwitcoski.github.io/OpenStreetMapPopulation/](https://jwitcoski.github.io/OpenStreetMapPopulation/)

BuildingPop estimates how many people live in an area by counting **OpenStreetMap buildings** and applying simple household assumptions. Draw a neighborhood on the map, and the tool returns a population estimate you can tune and compare against gridded reference datasets.

## Why this matters

Census and survey population numbers are authoritative, but they are often coarse, delayed, or hard to inspect for a specific block. Building footprints, by contrast, are continuously mapped in OpenStreetMap and already sit at street scale.

BuildingPop turns that map data into a transparent estimate:

- **Local and interactive** — pick any city-sized area and get a number in seconds
- **Explainable** — the formula and inputs (household size, occupancy, mapped completeness) are visible and editable
- **Comparable** — optionally check the OSM-based estimate against WorldPop or GHS-POP
- **Useful for planning gut-checks** — rough density for walkability, disaster prep, advocacy, or OSM completeness reviews

It is an **estimate**, not an official count. Incomplete mapping, wrong tags, and simplified household assumptions all affect the result.

## How to use it

1. Open the [live app](https://jwitcoski.github.io/OpenStreetMapPopulation/).
2. Search for a city or area (Photon / OpenStreetMap geocoder).
3. Zoom in to city level (drawing is paused when zoomed too far out — Overpass cannot handle country-sized queries).
4. Click **Draw area**, place points around the neighborhood, then **Finish** (or close the polygon).
5. Drag corner handles to reshape the boundary; use **Clear** to start over.
6. Read the population estimate, building breakdown, and optional reference comparison in the side panel.
7. Tune demographics (country preset, people per household, occupancy, floor area per household, mapped %).

Queries are limited to roughly **city / neighborhood scale** (about 12 km²) so public Overpass servers stay responsive.

## How the estimate works

Buildings are fetched from OpenStreetMap via the [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API), then classified:

| Category | Typical OSM tags | Role in the estimate |
| --- | --- | --- |
| Houses | `house`, `detached`, `terrace`, … | One household each |
| Apartments | `apartments`, `residential`, `dormitory`, … | Multiple units |
| Commercial / industrial | shops, offices, schools, … | Excluded from population |
| Other | `building=yes` and uncommon tags | Partially residential via % |

**Apartment units** prefer `building:flats` when tagged; otherwise `(footprint m² × levels) ÷ floor area per household`; otherwise levels (default 1).

**Population formula:**

```text
Estimate =
  (apartment units × occupancy × household size
   + (houses + other × residential%) × occupancy × household size)
  × mapped%
```

Country presets load average household size from **UN DESA Household Size and Composition 2022**. Occupancy, residential share, floor area per household, and mapped completeness are tool defaults you can edit.

Optional **Compare with** overlays:

- **WorldPop** (2020, ~100 m)
- **GHS-POP** (2025, ~100 m)

The panel shows the reference total and an OSM / reference ratio.

## Run locally (this branch)

This `gh-pages` branch hosts the **built static site** for GitHub Pages. To preview it on your machine:

```bash
# From the repo root — assets are loaded under /OpenStreetMapPopulation/
python3 -m http.server 8080
```

Then open:

[http://localhost:8080/OpenStreetMapPopulation/](http://localhost:8080/OpenStreetMapPopulation/)

Any static file server works the same way as long as the site is served at the `/OpenStreetMapPopulation/` base path (see `vite.config.js` `base` in the source tree).

## Develop from source

The interactive app is a Vite + MapLibre front end. From a checkout that includes `package.json` and the `scripts/` tree:

```bash
npm ci
npm run dev        # local Vite dev server
npm run build      # production build → dist/
npm run preview    # preview the production build
npm test           # unit + draw smoke + mobile smoke tests
```

Requirements: **Node.js 22+** (matches the Pages deploy workflow).

Useful scripts:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Hot-reload development |
| `npm run build` | Bundle for GitHub Pages |
| `npm run test:unit` | Population, heatmap, Overpass, demographics tests |
| `npm run test:draw` | Playwright draw smoke test |
| `npm run test:mobile` | Mobile draw / Overpass smoke |

## Tech stack

- **MapLibre GL** — map, draw controls, population heatmap
- **Overpass API** — OSM building query (with cache, spacing, and mirror failover)
- **Photon** — city / place search
- **Turf.js** — polygon area
- **GeoTIFF** — GHS-POP WCS comparison
- **Vite** — bundling and GitHub Pages deploy

## Data credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, queried via Overpass
- Household sizes: [UN DESA Household Size and Composition 2022](https://www.un.org/development/desa/pd/data/household-size-and-composition)
- Reference grids: [WorldPop](https://www.worldpop.org/), [GHS-POP (JRC)](https://ghsl.jrc.ec.europa.eu/ghs_pop2023.php)

## Limitations

- Depends on OSM completeness and tagging quality in the drawn area
- Overpass public instances rate-limit; busy periods may need **Try again**
- Not suitable for regions or countries — stay at city / neighborhood scale
- Apartment unit inference is approximate when `building:flats` is missing
- Reference datasets differ in year and methodology from the OSM building estimate

## License / contributing

Open an issue or pull request if you find bugs, want better defaults for a country, or have ideas for clearer estimates. Keep Overpass-friendly query sizes in mind when proposing features.
