#!/usr/bin/env python3
"""
Tile two GeoJSON files into a single PMTiles archive.

Usage:
    python tile.py <dots.geojson> <walls.geojson> <output.pmtiles>
"""

import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> None:
    print("$", " ".join(cmd))
    subprocess.run(cmd, check=True)


def main() -> None:
    if len(sys.argv) != 4:
        print(__doc__)
        sys.exit(1)

    dots_geojson = Path(sys.argv[1])
    walls_geojson = Path(sys.argv[2])
    output_pmtiles = Path(sys.argv[3])

    dots_mbtiles = output_pmtiles.with_suffix("").with_name(output_pmtiles.stem + "_dots.mbtiles")
    walls_mbtiles = output_pmtiles.with_suffix("").with_name(output_pmtiles.stem + "_walls.mbtiles")

    # DOTS-LEVEL: one Point per house, `avg_dist` property
    run([
        "tippecanoe",
        "-o", str(dots_mbtiles),
        "--force",
        "--layer=walls_dots",
        "--minimum-zoom=0",
        "--maximum-zoom=13",
        "--cluster-distance=2",
        "--cluster-densest-as-needed",
        "--accumulate-attribute=avg_dist:mean",
        str(dots_geojson),
    ])

    # WALLS-LELVEL: full LineStrings, untouched
    run([
        "tippecanoe",
        "-o", str(walls_mbtiles),
        "--force",
        "--layer=walls_lines",
        "--minimum-zoom=14",
        "--maximum-zoom=14",
        "--no-feature-limit",
        "--no-tile-size-limit",
        "--no-line-simplification",
        "--no-simplification-of-shared-nodes",
        str(walls_geojson),
    ])

    run([
        "tile-join",
        "-o", str(output_pmtiles),
        "--force",
        "--no-tile-size-limit",
        str(dots_mbtiles),
        str(walls_mbtiles),
    ])

    print(f"\nDone. Output: {output_pmtiles}")
    print(f"Intermediates kept: {dots_mbtiles}, {walls_mbtiles}")


if __name__ == "__main__":
    main()
