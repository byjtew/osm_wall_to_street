#!/usr/bin/env python3
"""
Build a single PMTiles archive from a directory of .osm.pbf files.

For each <name>.osm.pbf the script produces:
  <work_dir>/<name>_walls.geojson
  <work_dir>/<name>_centroids.geojson
  <work_dir>/<name>_dots.mbtiles
  <work_dir>/<name>_walls.mbtiles

If all four already exist, that region is skipped (restartable).
Finally all per-region mbtiles are joined into a single PMTiles file.

Usage:
    python build.py <input_dir> <output.pmtiles> [--work-dir <dir>]
"""

import argparse
import subprocess
import sys
from pathlib import Path


def run(cmd: list[str]) -> None:
    print("$", " ".join(str(c) for c in cmd))
    subprocess.run([str(c) for c in cmd], check=True)


def region_done(pbf: Path, work_dir: Path, stem: str) -> bool:
    """Return True if mbtiles exist and are newer than the source .osm.pbf."""
    needed = [
        work_dir / f"{stem}_dots.mbtiles",
        work_dir / f"{stem}_walls.mbtiles",
    ]
    if not all(p.exists() for p in needed):
        return False
    pbf_mtime = pbf.stat().st_mtime
    return all(p.stat().st_mtime >= pbf_mtime for p in needed)


def process_region(pbf: Path, work_dir: Path) -> tuple[Path, Path]:
    """Run Rust + tippecanoe for one region. Returns (dots_mbtiles, walls_mbtiles)."""
    stem = pbf.stem  # e.g. "colorado" from "colorado.osm.pbf"
    walls_geojson      = work_dir / f"{stem}_walls.geojson"
    centroids_geojson  = work_dir / f"{stem}_centroids.geojson"
    dots_mbtiles       = work_dir / f"{stem}_dots.mbtiles"
    walls_mbtiles      = work_dir / f"{stem}_walls.mbtiles"

    if region_done(pbf, work_dir, stem):
        print(f"[skip] {stem} — mbtiles up to date")
        return dots_mbtiles, walls_mbtiles

    print(f"\n=== Processing {stem} ===")

    # 1. Rust: .osm.pbf → GeoJSON
    run([
        "cargo", "run", "--release", "--",
        str(pbf),
        str(walls_geojson),
        str(centroids_geojson),
    ])

    # 2. tippecanoe: centroids → dots mbtiles
    run([
        "tippecanoe",
        "-o", dots_mbtiles,
        "--force",
        "--layer=walls_dots",
        "--minimum-zoom=0",
        "--maximum-zoom=13",
        "--cluster-distance=2",
        "--cluster-densest-as-needed",
        "--accumulate-attribute=avg_dist:mean",
        str(centroids_geojson),
    ])

    # 3. tippecanoe: walls → walls mbtiles
    run([
        "tippecanoe",
        "-o", walls_mbtiles,
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

    return dots_mbtiles, walls_mbtiles


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_dir",      type=Path, help="Directory containing .osm.pbf files")
    parser.add_argument("output_pmtiles", type=Path, help="Path for the output .pmtiles file")
    parser.add_argument("--work-dir",     type=Path, default=None,
                        help="Directory for intermediates (default: <input_dir>/work)")
    parser.add_argument("--clean-geojson", action="store_true",
                        help="Delete per-region GeoJSON files after mbtiles are produced")
    args = parser.parse_args()

    input_dir: Path = args.input_dir
    output_pmtiles: Path = args.output_pmtiles

    if not input_dir.is_dir():
        print(f"Error: {input_dir} is not a directory", file=sys.stderr)
        sys.exit(1)

    pbf_files = sorted(input_dir.glob("*.osm.pbf"))
    if not pbf_files:
        print(f"Error: no .osm.pbf files found in {input_dir}", file=sys.stderr)
        sys.exit(1)

    work_dir: Path = args.work_dir or (input_dir / "work")
    work_dir.mkdir(parents=True, exist_ok=True)

    print(f"Found {len(pbf_files)} region(s): {', '.join(p.stem for p in pbf_files)}")
    print(f"Work dir : {work_dir}")
    print(f"Output   : {output_pmtiles}\n")

    all_dots_mbtiles:  list[Path] = []
    all_walls_mbtiles: list[Path] = []

    for pbf in pbf_files:
        dots_mb, walls_mb = process_region(pbf, work_dir)
        all_dots_mbtiles.append(dots_mb)
        all_walls_mbtiles.append(walls_mb)
        if args.clean_geojson:
            for geojson in [
                work_dir / f"{pbf.stem}_walls.geojson",
                work_dir / f"{pbf.stem}_centroids.geojson",
            ]:
                if geojson.exists():
                    geojson.unlink()
                    print(f"[clean] Removed {geojson}")

    # 4. tile-join: merge everything into one PMTiles
    print("\n=== Joining all mbtiles into PMTiles ===")
    run([
        "tile-join",
        "-o", output_pmtiles,
        "--force",
        "--no-tile-size-limit",
        *all_dots_mbtiles,
        *all_walls_mbtiles,
    ])

    print(f"\nDone. Output: {output_pmtiles}")


if __name__ == "__main__":
    main()
