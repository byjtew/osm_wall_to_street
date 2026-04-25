import "./styles.css";
import "maplibre-gl/dist/maplibre-gl.css";

let maplibregl;
let MapboxOverlay;
let TileLayer;
let LineLayer;
let ScatterplotLayer;
let PMTiles;
let VectorTile;
let Pbf;

const loadMapRuntime = async () => {
	const [maplibreModule, deckMapboxModule, deckGeoLayersModule, deckLayersModule, pmtilesModule, vectorTileModule, pbfModule] = await Promise.all([
		import("maplibre-gl"),
		import("@deck.gl/mapbox"),
		import("@deck.gl/geo-layers"),
		import("@deck.gl/layers"),
		import("pmtiles"),
		import("@mapbox/vector-tile"),
		import("pbf"),
	]);

	maplibregl = maplibreModule.default;
	MapboxOverlay = deckMapboxModule.MapboxOverlay;
	TileLayer = deckGeoLayersModule.TileLayer;
	LineLayer = deckLayersModule.LineLayer;
	ScatterplotLayer = deckLayersModule.ScatterplotLayer;
	PMTiles = pmtilesModule.PMTiles;
	VectorTile = vectorTileModule.VectorTile;
	Pbf = pbfModule.default;
};

await loadMapRuntime();

const TILESET_INDEX_URL = "https://osm.darlink.space/tileset.json";
const INITIAL_VIEW = { center: [0, 20], zoom: 2 };
const DATASET_PRESET_SOURCE_ID = "dataset-presets";
const DATASET_PRESET_HALO_LAYER_ID = "dataset-presets-halo";
const DATASET_PRESET_LAYER_ID = "dataset-presets";
const DATASET_PRESET_LABEL_LAYER_ID = "dataset-presets-label";
const DATASET_PRESET_MAX_ZOOM = 8;

let datasets = [];
let currentDataset = null;
let pmtilesFiles = [];
let datasetPresetData = { type: "FeatureCollection", features: [] };

let minDist = 5;
let maxDist = 35;
let currentZoom = 11;
let currentColorMap = "plasma";
let useFeet = false;
let showMapLabels = true;
const M_TO_FT = 3.28084;

function formatDistance(meters) {
	if (useFeet) return `${Math.round(meters * M_TO_FT)} ft`;
	return `${meters % 1 === 0 ? meters : meters.toFixed(1)} m`;
}

function updateDistValue() {
	distValue.textContent = `${formatDistance(minDist)} - ${formatDistance(maxDist)}`;
}

const SLIDER_MIN = 0;

// radiusMinPixels for dot layer, keyed by tile zoom level
const DOT_RADIUS_MIN_PIXELS = { 13: 2, 12: 1.5 };
let sliderMax = 50;

const BASEMAPS = [
	{ key: "dark", label: "Dark", url: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json" },
	{ key: "light", label: "Light", url: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json" },
	{ key: "voyager", label: "Voyager", url: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json" },
];
let basemapIdx = 0;

const map = new maplibregl.Map({
	container: "container",
	style: BASEMAPS[0].url,
	center: INITIAL_VIEW.center,
	zoom: INITIAL_VIEW.zoom,
	maxZoom: 18,
	attributionControl: false,
	preserveDrawingBuffer: true,
	canvasContextAttributes: {
		preserveDrawingBuffer: true,
	},
});

const zoomThumb = document.getElementById("zoom-thumb");
const zoomBadge = document.getElementById("zoom-badge");

const ZOOM_MIN = 1;
const ZOOM_MAX = 18;

const updateZoomIndicator = () => {
	const pct = ((ZOOM_MAX - currentZoom) / (ZOOM_MAX - ZOOM_MIN)) * 100;
	zoomThumb.style.top = `${Math.max(0, Math.min(100, pct))}%`;
	zoomBadge.textContent = `zoom: ${currentZoom.toFixed(1)}`;
};

map.on("zoom", () => {
	currentZoom = map.getZoom();
	updateZoomIndicator();
	if (overlay) overlay.setProps({ layers: buildLayers() });
});

let overlay = null;
let firstLabelId = null;
let hoveredDatasetPresetId = null;

const applyMapLabelVisibility = () => {
	const layers = map.getStyle()?.layers ?? [];
	const visibility = showMapLabels ? "visible" : "none";
	layers.forEach((layer) => {
		if (layer.type !== "symbol") return;
		if (layer.id === DATASET_PRESET_LABEL_LAYER_ID) return;
		try {
			map.setLayoutProperty(layer.id, "visibility", visibility);
		} catch {
			// Ignore layers that cannot be toggled.
		}
	});
};

const ensureDatasetPresetLayers = () => {
	if (!map.getSource(DATASET_PRESET_SOURCE_ID)) {
		map.addSource(DATASET_PRESET_SOURCE_ID, {
			type: "geojson",
			promoteId: "datasetKey",
			data: datasetPresetData,
		});
	}

	if (!map.getLayer(DATASET_PRESET_HALO_LAYER_ID)) {
		map.addLayer({
			id: DATASET_PRESET_HALO_LAYER_ID,
			type: "circle",
			source: DATASET_PRESET_SOURCE_ID,
			maxzoom: DATASET_PRESET_MAX_ZOOM,
			paint: {
				"circle-radius": 9,
				"circle-color": "rgba(255, 255, 255, 0.14)",
				"circle-stroke-width": 1,
				"circle-stroke-color": "rgba(255, 255, 255, 0.45)",
			},
		}, firstLabelId);
	}

	if (!map.getLayer(DATASET_PRESET_LAYER_ID)) {
		map.addLayer({
			id: DATASET_PRESET_LAYER_ID,
			type: "circle",
			source: DATASET_PRESET_SOURCE_ID,
			maxzoom: DATASET_PRESET_MAX_ZOOM,
			paint: {
				"circle-radius": 5,
				"circle-color": "rgba(255, 255, 255, 0.98)",
				"circle-stroke-width": 1,
				"circle-stroke-color": "rgba(12, 12, 12, 0.45)",
			},
		}, firstLabelId);
	}

	if (!map.getLayer(DATASET_PRESET_LABEL_LAYER_ID)) {
		map.addLayer({
			id: DATASET_PRESET_LABEL_LAYER_ID,
			type: "symbol",
			source: DATASET_PRESET_SOURCE_ID,
			maxzoom: DATASET_PRESET_MAX_ZOOM,
			layout: {
				"text-field": ["get", "label"],
				"text-size": 11,
				"text-font": ["Open Sans Semibold", "Arial Unicode MS Regular"],
				"text-offset": [0, -1.6],
				"text-anchor": "bottom",
				"text-allow-overlap": true,
				"text-ignore-placement": true,
			},
			paint: {
				"text-color": "rgba(255, 255, 255, 0.98)",
				"text-halo-color": "rgba(12, 12, 12, 0.82)",
				"text-halo-width": 2,
				"text-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0],
			},
		}, firstLabelId);
	}
};

const setHoveredDatasetPreset = (datasetPresetId) => {
	if (hoveredDatasetPresetId === datasetPresetId) return;
	if (hoveredDatasetPresetId !== null && map.getSource(DATASET_PRESET_SOURCE_ID)) {
		map.setFeatureState({ source: DATASET_PRESET_SOURCE_ID, id: hoveredDatasetPresetId }, { hover: false });
	}
	hoveredDatasetPresetId = datasetPresetId;
	if (hoveredDatasetPresetId !== null && map.getSource(DATASET_PRESET_SOURCE_ID)) {
		map.setFeatureState({ source: DATASET_PRESET_SOURCE_ID, id: hoveredDatasetPresetId }, { hover: true });
	}
};

const syncDatasetPresetSource = () => {
	if (!map.getStyle()) return;
	ensureDatasetPresetLayers();
	const source = map.getSource(DATASET_PRESET_SOURCE_ID);
	if (source) source.setData(datasetPresetData);
	if (hoveredDatasetPresetId !== null) setHoveredDatasetPreset(null);
};

map.on("style.load", () => {
	if (overlay) {
		try {
			map.removeControl(overlay);
		} catch {
			// noop
		}
	}
	firstLabelId = map.getStyle().layers.find((l) => l.type === "symbol")?.id ?? null;
	hoveredDatasetPresetId = null;
	overlay = new MapboxOverlay({ interleaved: true });
	map.addControl(overlay);
	overlay.setProps({ layers: buildLayers() });
	applyMapLabelVisibility();
	syncDatasetPresetSource();
});

map.on("click", (event) => {
	if (!map.getLayer(DATASET_PRESET_LAYER_ID)) return;
	const preset = map.queryRenderedFeatures(event.point, { layers: [DATASET_PRESET_LAYER_ID] })[0];
	const datasetKey = preset?.properties?.datasetKey;
	if (!datasetKey) return;
	applyDataset(datasetKey);
});

map.on("mousemove", (event) => {
	if (!map.getLayer(DATASET_PRESET_LAYER_ID)) {
		setHoveredDatasetPreset(null);
		map.getCanvas().style.cursor = "";
		return;
	}
	const hoveredPreset = map.queryRenderedFeatures(event.point, { layers: [DATASET_PRESET_LAYER_ID] })[0] ?? null;
	setHoveredDatasetPreset(hoveredPreset?.id ?? null);
	map.getCanvas().style.cursor = hoveredPreset ? "pointer" : "";
});

map.on("mouseout", () => {
	setHoveredDatasetPreset(null);
	map.getCanvas().style.cursor = "";
});

const lerpStops = (stops, n) => {
	const seg = (stops.length - 1) * n;
	const i = Math.min(Math.floor(seg), stops.length - 2);
	const t = seg - i;
	const a = stops[i];
	const b = stops[i + 1];
	return [
		Math.round(a[0] + (b[0] - a[0]) * t),
		Math.round(a[1] + (b[1] - a[1]) * t),
		Math.round(a[2] + (b[2] - a[2]) * t),
		255,
	];
};

const colorMaps = {
	plasma: (n) => lerpStops([[13, 8, 135], [84, 2, 163], [139, 10, 165], [185, 50, 137], [219, 92, 104], [244, 136, 73], [254, 188, 43], [240, 249, 33]], n),
	viridis: (n) => lerpStops([[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [53, 183, 121], [110, 206, 88], [180, 222, 44], [253, 231, 37]], n),
	inferno: (n) => lerpStops([[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [252, 196, 82], [252, 255, 164]], n),
	magma: (n) => lerpStops([[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]], n),
	cividis: (n) => lerpStops([[0, 34, 78], [27, 57, 106], [60, 76, 130], [92, 98, 134], [120, 119, 124], [148, 143, 102], [183, 170, 65], [218, 203, 20], [253, 237, 55]], n),
};

const getColor = (dist) => {
	const range = maxDist - minDist;
	const norm = range > 0 ? Math.max(0, Math.min((dist - minDist) / range, 1)) : 0;
	return colorMaps[currentColorMap](norm);
};

const loadVectorLayerFromTile = (tileData, layerName) => {
	if (!tileData) return null;
	const vt = new VectorTile(new Pbf(tileData));
	return vt.layers[layerName] ?? null;
};

const loadLayersFromAllPmtiles = async (z, x, y, layerName) => {
	if (!pmtilesFiles.length) return [];
	const allLayers = await Promise.all(pmtilesFiles.map(async (pmtilesFile) => {
		try {
			const tile = await pmtilesFile.getZxy(z, x, y);
			if (!tile || !tile.data) return null;
			return loadVectorLayerFromTile(tile.data, layerName);
		} catch {
			return null;
		}
	}));

	return allLayers.filter(Boolean);
};

const buildLayers = () => [
	new TileLayer({
		id: `dots-layer-${currentDataset?.key ?? "none"}`,
		beforeId: firstLabelId,
		visible: currentZoom < 14,
		minZoom: 0,
		maxZoom: 13,
		tileSize: 512,
		updateTriggers: { renderSubLayers: [minDist, maxDist, currentColorMap] },
		getTileData: async ({ index: { x, y, z } }) => {
			const layers = await loadLayersFromAllPmtiles(z, x, y, "walls_dots");
			if (!layers.length) return [];
			const points = [];
			for (const layer of layers) {
				for (let i = 0; i < layer.length; i++) {
					const feature = layer.feature(i).toGeoJSON(x, y, z);
					const [lon, lat] = feature.geometry.coordinates;
					points.push({ position: [lon, lat], dist: feature.properties.avg_dist || 0 });
				}
			}
			return points;
		},
		renderSubLayers: ({ id, data, tile }) => new ScatterplotLayer({
			id,
			data: data || [],
			getPosition: (d) => d.position,
			getRadius: 2,
			radiusMinPixels: DOT_RADIUS_MIN_PIXELS[tile?.index?.z] ?? 1,
			getFillColor: (d) => getColor(d.dist),
			updateTriggers: { getFillColor: [minDist, maxDist, currentColorMap] },
		}),
	}),

	new TileLayer({
		id: `lines-layer-${currentDataset?.key ?? "none"}`,
		beforeId: firstLabelId,
		visible: currentZoom >= 14,
		minZoom: 14,
		maxZoom: 14,
		tileSize: 512,
		updateTriggers: { renderSubLayers: [minDist, maxDist, currentColorMap] },
		getTileData: async ({ index: { x, y, z } }) => {
			const layers = await loadLayersFromAllPmtiles(z, x, y, "walls_lines");
			if (!layers.length) return [];
			const segments = [];
			for (const layer of layers) {
				for (let i = 0; i < layer.length; i++) {
					const feature = layer.feature(i).toGeoJSON(x, y, z);
					const coords = feature.geometry.coordinates;
					const dists = typeof feature.properties.dists === "string"
						? JSON.parse(feature.properties.dists)
						: feature.properties.dists || [];
					for (let j = 0; j < coords.length - 1; j++) {
						segments.push({
							sourcePosition: coords[j],
							targetPosition: coords[j + 1],
							dist: ((dists[j] || 0) + (dists[j + 1] || 0)) / 2,
						});
					}
				}
			}
			return segments;
		},
		renderSubLayers: ({ id, data, tile }) => new LineLayer({
			id,
			data: data || [],
			getSourcePosition: (d) => d.sourcePosition,
			getTargetPosition: (d) => d.targetPosition,
			getColor: (d) => getColor(d.dist),
			getWidth: Math.min(tile.index.z / 9, 2),
			widthMinPixels: 1,
			updateTriggers: { getColor: [minDist, maxDist, currentColorMap] },
		}),
	}),
];

const preview = document.getElementById("colormap-preview");
preview.width = 264;

const toX = (val) => {
	const span = sliderMax - SLIDER_MIN;
	if (span <= 0) return 0;
	return Math.round(((val - SLIDER_MIN) / span) * preview.width);
};

const drawPreview = () => {
	const ctx = preview.getContext("2d");
	const w = preview.width;
	const h = preview.height;
	const x0 = toX(minDist);
	const x1 = toX(maxDist);
	const [sr, sg, sb] = colorMaps[currentColorMap](0);
	ctx.fillStyle = `rgb(${sr},${sg},${sb})`;
	ctx.fillRect(0, 0, x0, h);
	if (x1 > x0) {
		const grad = ctx.createLinearGradient(x0, 0, x1, 0);
		for (let i = 0; i <= 16; i++) {
			const n = i / 16;
			const [r, g, b] = colorMaps[currentColorMap](n);
			grad.addColorStop(n, `rgb(${r},${g},${b})`);
		}
		ctx.fillStyle = grad;
		ctx.fillRect(x0, 0, x1 - x0, h);
	}
	const [tr, tg, tb] = colorMaps[currentColorMap](1);
	ctx.fillStyle = `rgb(${tr},${tg},${tb})`;
	ctx.fillRect(x1, 0, w - x1, h);
	ctx.fillStyle = "rgba(255,255,255,0.9)";
	ctx.fillRect(x0 - 1, 0, 2, h);
	ctx.fillRect(x1 - 1, 0, 2, h);
};

drawPreview();

const distSliderMinEl = document.getElementById("dist-slider-min");
const distSliderMaxEl = document.getElementById("dist-slider-max");
const distSliderActiveEl = document.getElementById("dist-slider-active");
const distValue = document.getElementById("dist-value");
const sliderMaxDisplay = document.getElementById("slider-max-display");
const sliderMaxInput = document.getElementById("slider-max-input");

const updateSliderMaxDisplay = () => {
	sliderMaxDisplay.innerHTML = `<span class="slider-max-label">Max:</span><span class="slider-max-value">${formatDistance(sliderMax)}</span>`;
};

const syncSliderMaxInputSize = () => {
	sliderMaxInput.size = Math.max(3, sliderMaxInput.value.length || 0);
};

const updateSliderUi = () => {
	distSliderMinEl.min = String(SLIDER_MIN);
	distSliderMinEl.max = String(sliderMax);
	distSliderMaxEl.min = String(SLIDER_MIN);
	distSliderMaxEl.max = String(sliderMax);
	distSliderMinEl.value = String(minDist);
	distSliderMaxEl.value = String(maxDist);
	const left = ((minDist - SLIDER_MIN) / (sliderMax - SLIDER_MIN)) * 100;
	const right = ((maxDist - SLIDER_MIN) / (sliderMax - SLIDER_MIN)) * 100;
	distSliderActiveEl.style.left = `${left}%`;
	distSliderActiveEl.style.width = `${Math.max(0, right - left)}%`;
};

const onSliderChanged = () => {
	updateDistValue();
	drawPreview();
	updateSliderUi();
	if (overlay) overlay.setProps({ layers: buildLayers() });
};

distSliderMinEl.addEventListener("input", () => {
	const next = Number.parseFloat(distSliderMinEl.value);
	minDist = Math.min(next, maxDist);
	onSliderChanged();
});

distSliderMaxEl.addEventListener("input", () => {
	const next = Number.parseFloat(distSliderMaxEl.value);
	maxDist = Math.max(next, minDist);
	onSliderChanged();
});

updateSliderMaxDisplay();
syncSliderMaxInputSize();
updateSliderUi();
updateDistValue();

const enterMaxEditMode = () => {
	sliderMaxInput.value = String(sliderMax);
	syncSliderMaxInputSize();
	sliderMaxDisplay.style.display = "none";
	sliderMaxInput.classList.add("editing");
	sliderMaxInput.focus();
	sliderMaxInput.select();
};

const applySliderMaxInput = () => {
	const parsed = Number.parseFloat(sliderMaxInput.value);
	if (!Number.isFinite(parsed) || parsed <= SLIDER_MIN) {
		sliderMaxInput.value = String(sliderMax);
		syncSliderMaxInputSize();
		return;
	}

	sliderMax = Math.round(parsed);
	sliderMaxInput.value = String(sliderMax);
	syncSliderMaxInputSize();
	maxDist = Math.min(maxDist, sliderMax);
	if (minDist > maxDist) minDist = maxDist;

	updateSliderMaxDisplay();
	onSliderChanged();
};

const exitMaxEditMode = (shouldApply) => {
	if (shouldApply) applySliderMaxInput();
	sliderMaxInput.classList.remove("editing");
	sliderMaxDisplay.style.display = "inline-block";
	updateSliderMaxDisplay();
};

sliderMaxDisplay.addEventListener("click", enterMaxEditMode);

sliderMaxInput.addEventListener("input", () => {
	sliderMaxInput.value = sliderMaxInput.value.replace(/\D+/g, "");
	syncSliderMaxInputSize();
});

sliderMaxInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		e.preventDefault();
		exitMaxEditMode(true);
	} else if (e.key === "Escape") {
		e.preventDefault();
		sliderMaxInput.value = String(sliderMax);
		exitMaxEditMode(false);
	}
});

sliderMaxInput.addEventListener("blur", () => {
	exitMaxEditMode(true);
});

const colorMapNames = ["plasma", "viridis", "inferno", "magma", "cividis"];
const colormapMenu = document.getElementById("colormap-menu");
const colormapTrigger = document.getElementById("colormap-trigger");
const colormapCurrentSwatch = document.getElementById("colormap-current-swatch");
const colormapCurrentLabel = document.getElementById("colormap-current-label");

const titleCase = (v) => v.charAt(0).toUpperCase() + v.slice(1);
const gradientForMap = (mapName) => {
	const stops = [];
	for (let i = 0; i <= 8; i++) {
		const n = i / 8;
		const [r, g, b] = colorMaps[mapName](n);
		stops.push(`rgb(${r},${g},${b}) ${(n * 100).toFixed(1)}%`);
	}
	return `linear-gradient(90deg, ${stops.join(",")})`;
};

const updateColormapUi = () => {
	colormapCurrentLabel.textContent = titleCase(currentColorMap);
	colormapCurrentSwatch.style.background = gradientForMap(currentColorMap);
	colormapMenu.querySelectorAll(".colormap-option").forEach((btn) => {
		btn.classList.toggle("active", btn.dataset.map === currentColorMap);
		btn.setAttribute("aria-selected", btn.dataset.map === currentColorMap ? "true" : "false");
	});
};

const applyColormap = (nextMap) => {
	if (!colorMaps[nextMap]) return;
	currentColorMap = nextMap;
	updateColormapUi();
	drawPreview();
	if (overlay) overlay.setProps({ layers: buildLayers() });
};

colorMapNames.forEach((mapName) => {
	const option = document.createElement("button");
	option.type = "button";
	option.role = "option";
	option.className = "colormap-option";
	option.dataset.map = mapName;
	option.setAttribute("aria-selected", "false");
	option.innerHTML = `<span class="swatch" style="--swatch-gradient:${gradientForMap(mapName)}"></span><span>${titleCase(mapName)}</span>`;
	option.addEventListener("click", () => {
		applyColormap(mapName);
		colormapMenu.classList.remove("open");
		colormapTrigger.setAttribute("aria-expanded", "false");
	});
	colormapMenu.appendChild(option);
});

colormapTrigger.addEventListener("click", () => {
	const willOpen = !colormapMenu.classList.contains("open");
	colormapMenu.classList.toggle("open", willOpen);
	colormapTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
});

document.addEventListener("click", (e) => {
	if (!e.target.closest("#colormap-picker")) {
		colormapMenu.classList.remove("open");
		colormapTrigger.setAttribute("aria-expanded", "false");
	}
});

const datasetMenu = document.getElementById("dataset-menu");
const datasetTrigger = document.getElementById("dataset-trigger");
const datasetCurrentLabel = document.getElementById("dataset-current-label");

const isPmtilesUrl = (url) => /^pmtiles:\/\//i.test(url) || /\.pmtiles(?:$|[?#])/i.test(url);

const toRawPmtilesUrl = (value) => {
	if (typeof value !== "string") return "";
	const trimmed = value.trim();
	if (!trimmed) return "";
	return trimmed.replace(/^pmtiles:\/\//i, "");
};

const normalizePmtilesUrls = (entry) => {
	const urls = [];

	if (typeof entry.pmtilesUrl === "string") {
		urls.push(toRawPmtilesUrl(entry.pmtilesUrl));
	}

	if (Array.isArray(entry.pmtilesUrls)) {
		entry.pmtilesUrls.forEach((url) => {
			urls.push(toRawPmtilesUrl(url));
		});
	}

	if (entry.sources && typeof entry.sources === "object") {
		Object.values(entry.sources).forEach((sourceEntry) => {
			if (!sourceEntry || typeof sourceEntry !== "object") return;
			if (typeof sourceEntry.url !== "string") return;
			if (!isPmtilesUrl(sourceEntry.url)) return;
			urls.push(toRawPmtilesUrl(sourceEntry.url));
		});
	}

	return [...new Set(urls.filter(Boolean))];
};

const normalizeDatasetEntry = (entry) => {
	if (!entry || typeof entry !== "object") return null;
	const key = typeof entry.key === "string" ? entry.key.trim() : "";
	const label = typeof entry.label === "string" ? entry.label.trim() : "";
	const pmtilesUrls = normalizePmtilesUrls(entry);
	const center = Array.isArray(entry.center) ? entry.center : [];
	const lon = Number.parseFloat(center[0]);
	const lat = Number.parseFloat(center[1]);
	const zoom = Number.parseFloat(entry.zoom);

	if (!key || !label || !pmtilesUrls.length) return null;
	if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(zoom)) return null;

	return {
		key,
		label,
		pmtilesUrls,
		center: [lon, lat],
		zoom,
	};
};

const normalizeTilesetPayload = (payload) => {
	const list = Array.isArray(payload)
		? payload
		: Array.isArray(payload?.datasets)
			? payload.datasets
			: [];

	const seen = new Set();
	const normalized = [];
	list.forEach((entry) => {
		const parsed = normalizeDatasetEntry(entry);
		if (!parsed || seen.has(parsed.key)) return;
		seen.add(parsed.key);
		normalized.push(parsed);
	});

	return normalized;
};

const collectAllPmtilesUrls = (datasetList) => {
	const urls = [];
	datasetList.forEach((dataset) => {
		dataset.pmtilesUrls.forEach((url) => urls.push(url));
	});
	return [...new Set(urls)];
};

const refreshPmtilesFiles = () => {
	pmtilesFiles = collectAllPmtilesUrls(datasets).map((url) => new PMTiles(url));
};

const closeDatasetMenu = () => {
	datasetMenu.classList.remove("open");
	datasetTrigger.setAttribute("aria-expanded", "false");
};

const updateDatasetMarkers = () => {
	if (!datasets.length) {
		datasetPresetData = { type: "FeatureCollection", features: [] };
		syncDatasetPresetSource();
		return;
	}

	const visiblePresets = datasets;
	datasetPresetData = {
		type: "FeatureCollection",
		features: visiblePresets.map((dataset) => ({
			id: dataset.key,
			type: "Feature",
			geometry: {
				type: "Point",
				coordinates: dataset.center,
			},
			properties: {
				datasetKey: dataset.key,
				label: dataset.label,
			},
		})),
	};
	syncDatasetPresetSource();
};

const updateDatasetUi = () => {
	datasetCurrentLabel.textContent = currentDataset?.label ?? "No datasets";
	datasetTrigger.disabled = datasets.length === 0;
	datasetMenu.querySelectorAll(".dataset-option").forEach((btn) => {
		const isActive = btn.dataset.key === currentDataset?.key;
		btn.classList.toggle("active", isActive);
		btn.setAttribute("aria-selected", isActive ? "true" : "false");
	});
};

const smoothEasing = (t) => 1 - (1 - t) ** 3;
let hasTeleportedToDatasetOnce = false;

const smoothTeleportTo = (dataset) => {
	map.stop();
	if (!hasTeleportedToDatasetOnce) {
		map.jumpTo({
			center: dataset.center,
			zoom: dataset.zoom,
		});
		hasTeleportedToDatasetOnce = true;
		return;
	}

	map.easeTo({
		center: dataset.center,
		zoom: dataset.zoom,
		duration: 1000,
		easing: smoothEasing,
		essential: true,
	});
};

const applyDataset = (datasetKey) => {
	const next = datasets.find((dataset) => dataset.key === datasetKey);
	if (!next) return;

	if (!currentDataset || next.key !== currentDataset.key) {
		currentDataset = next;
		updateDatasetUi();
		updateDatasetMarkers();
		if (overlay) overlay.setProps({ layers: buildLayers() });
	}

	smoothTeleportTo(next);
};

const rebuildDatasetMenu = () => {
	datasetMenu.innerHTML = "";
	if (!datasets.length) {
		updateDatasetUi();
		updateDatasetMarkers();
		return;
	}
	datasets.forEach((dataset) => {
		const option = document.createElement("button");
		option.type = "button";
		option.role = "option";
		option.className = "dataset-option";
		option.dataset.key = dataset.key;
		option.textContent = dataset.label;
		option.setAttribute("aria-selected", "false");
		option.addEventListener("click", () => {
			applyDataset(dataset.key);
			closeDatasetMenu();
		});
		datasetMenu.appendChild(option);
	});
	updateDatasetUi();
	updateDatasetMarkers();
};

const loadDatasetsFromEndpoint = async () => {
	try {
		const response = await fetch(TILESET_INDEX_URL, { cache: "no-store" });
		if (!response.ok) throw new Error(`Failed to fetch ${TILESET_INDEX_URL}: ${response.status}`);
		const payload = await response.json();
		const nextDatasets = normalizeTilesetPayload(payload);
		if (!nextDatasets.length) throw new Error("Tileset index did not contain valid datasets.");

		datasets = nextDatasets;
		currentDataset = datasets[0];
		refreshPmtilesFiles();
		rebuildDatasetMenu();
		updateDatasetMarkers();
		if (overlay) overlay.setProps({ layers: buildLayers() });
		smoothTeleportTo(currentDataset);
	} catch (err) {
		console.error("Failed to load datasets from endpoint.", err);
		datasets = [];
		currentDataset = null;
		pmtilesFiles = [];
		rebuildDatasetMenu();
		updateDatasetMarkers();
		if (overlay) overlay.setProps({ layers: buildLayers() });
	}
};

datasetTrigger.addEventListener("click", () => {
	const willOpen = !datasetMenu.classList.contains("open");
	datasetMenu.classList.toggle("open", willOpen);
	datasetTrigger.setAttribute("aria-expanded", willOpen ? "true" : "false");
});

document.addEventListener("click", (e) => {
	if (!e.target.closest("#dataset-picker")) closeDatasetMenu();
});

rebuildDatasetMenu();
loadDatasetsFromEndpoint();

const aboutModal = document.getElementById("about-modal");

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape") {
		if (aboutModal.classList.contains("open")) setAboutOpen(false);
		colormapMenu.classList.remove("open");
		colormapTrigger.setAttribute("aria-expanded", "false");
		closeDatasetMenu();
	}
});

updateColormapUi();

const searchInput = document.getElementById("search-input");
const searchClear = document.getElementById("search-clear");
const searchResults = document.getElementById("search-results");

let searchDebounce = null;

const closeResults = () => {
	if (!searchResults) return;
	searchResults.innerHTML = "";
	searchResults.classList.remove("open");
};

const flyTo = (lon, lat, zoom = 15) => {
	map.flyTo({ center: [lon, lat], zoom, duration: 800 });
	closeResults();
	if (searchInput) searchInput.blur();
};

const doSearch = async (query) => {
	if (!searchInput || !searchResults) return;
	if (!query.trim()) {
		closeResults();
		return;
	}
	const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`;
	let items;
	try {
		const res = await fetch(url, { headers: { "Accept-Language": "en" } });
		items = await res.json();
	} catch {
		items = [];
	}
	searchResults.innerHTML = "";
	if (!items.length) {
		searchResults.innerHTML = '<div class="search-no-result">No results found</div>';
	} else {
		items.forEach(({ display_name, lon, lat }) => {
			const el = document.createElement("div");
			el.className = "search-result-item";
			el.textContent = display_name;
			el.title = display_name;
			el.addEventListener("click", () => flyTo(Number.parseFloat(lon), Number.parseFloat(lat)));
			searchResults.appendChild(el);
		});
	}
	searchResults.classList.add("open");
};

if (searchInput && searchClear && searchResults) {
	searchInput.addEventListener("input", () => {
		searchClear.classList.toggle("visible", searchInput.value.length > 0);
		clearTimeout(searchDebounce);
		searchDebounce = setTimeout(() => doSearch(searchInput.value), 350);
	});

	searchInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter") {
			clearTimeout(searchDebounce);
			doSearch(searchInput.value);
		}
		if (e.key === "Escape") {
			closeResults();
			searchInput.blur();
		}
	});

	searchClear.addEventListener("click", () => {
		searchInput.value = "";
		searchClear.classList.remove("visible");
		closeResults();
		searchInput.focus();
	});

	document.addEventListener("click", (e) => {
		if (!e.target.closest("#search-bar")) closeResults();
	});
}

const menuTrigger = document.getElementById("map-menu-trigger");
const menuItems = document.getElementById("map-menu-items");
let menuOpen = false;
const aboutDetails = document.querySelector("#ui details");
const aboutOpenBtn = document.getElementById("about-open-btn");
const aboutCloseBtn = document.getElementById("about-close-btn");

const setAboutOpen = (isOpen) => {
	aboutModal.classList.toggle("open", isOpen);
	aboutModal.setAttribute("aria-hidden", isOpen ? "false" : "true");
};

const openAboutModal = () => {
	if (aboutDetails) aboutDetails.open = false;
	setAboutOpen(true);
};

if (aboutDetails) {
	aboutDetails.addEventListener("toggle", () => {
		if (!aboutDetails.open) return;
		openAboutModal();
	});
}

aboutOpenBtn.addEventListener("click", (e) => {
	e.preventDefault();
	e.stopPropagation();
	openAboutModal();
});
aboutCloseBtn.addEventListener("click", () => setAboutOpen(false));
aboutModal.addEventListener("click", (e) => {
	if (e.target === aboutModal) setAboutOpen(false);
});

menuTrigger.addEventListener("click", (e) => {
	e.stopPropagation();
	menuOpen = !menuOpen;
	menuItems.classList.toggle("open", menuOpen);
});
document.addEventListener("click", (e) => {
	if (menuOpen && !e.target.closest("#map-menu")) {
		menuOpen = false;
		menuItems.classList.remove("open");
	}
});

const basemapMenuBtn = document.getElementById("basemap-btn");
const labelsBtn = document.getElementById("labels-btn");
const syncUiTheme = () => {
	document.body.classList.toggle("light-ui", BASEMAPS[basemapIdx].key !== "dark");
};
const updateBasemapBtn = () => {
	basemapMenuBtn.innerHTML = `${BASEMAPS[basemapIdx].label} map`;
	syncUiTheme();
};
const updateLabelsBtn = () => {
	labelsBtn.innerHTML = showMapLabels ? "Hide labels" : "Show labels";
};
updateBasemapBtn();
updateLabelsBtn();
updateZoomIndicator();
basemapMenuBtn.addEventListener("click", () => {
	basemapIdx = (basemapIdx + 1) % BASEMAPS.length;
	map.setStyle(BASEMAPS[basemapIdx].url);
	updateBasemapBtn();
});
labelsBtn.addEventListener("click", () => {
	showMapLabels = !showMapLabels;
	applyMapLabelVisibility();
	updateLabelsBtn();
});

const unitsBtn = document.getElementById("units-btn");
unitsBtn.addEventListener("click", () => {
	useFeet = !useFeet;
	unitsBtn.innerHTML = useFeet ? "Switch to meters" : "Switch to feet";
	updateDistValue();
	updateSliderMaxDisplay();
});

const screenshotBtn = document.getElementById("screenshot-btn");

const downloadBlob = (blob) => {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `osm_house_to_street-${Date.now()}.png`;
	document.body.appendChild(a);
	a.click();
	document.body.removeChild(a);
	URL.revokeObjectURL(url);
};

const canvasToBlob = (canvas) => new Promise((resolve, reject) => {
	try {
		canvas.toBlob((blob) => {
			if (blob) {
				resolve(blob);
				return;
			}
			reject(new Error("Screenshot export returned an empty blob."));
		}, "image/png");
	} catch (err) {
		reject(err);
	}
});

const showScreenshotError = (err) => {
	console.error("Screenshot failed", err);
	window.alert("Screenshot failed. This is usually caused by cross-origin resources without proper CORS headers.");
};

screenshotBtn.addEventListener("click", async () => {
	try {
		map.triggerRepaint();
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const canvas = map.getCanvas();
		const blob = await canvasToBlob(canvas);
		downloadBlob(blob);
	} catch (err) {
		showScreenshotError(err);
	}
});
