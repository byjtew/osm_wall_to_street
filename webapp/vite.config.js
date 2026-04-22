import { defineConfig } from "vite";

export default defineConfig({
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (!id.includes("node_modules")) return;

					if (id.includes("@deck.gl") || id.includes("luma.gl") || id.includes("@math.gl")) return "vendor-deckgl";
					if (id.includes("maplibre-gl")) return "vendor-maplibre";
					if (id.includes("pmtiles") || id.includes("@mapbox/vector-tile") || id.includes("node_modules/pbf") || id.includes("node_modules\\pbf")) {
						return "vendor-tiles";
					}
				},
			},
		},
	},
});
