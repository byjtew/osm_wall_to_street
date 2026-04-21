use std::{
    env,
    f64::{self},
    fs::File,
    io::Write,
};

use geo::{Distance};
use proj::Coord;

const INCLUDED_HIGHWAY_TAG_VALUES: [&str; 12] = [
    "residential",
    "living_street",
    "service",
    "unclassified",
    "primary",
    "primary_link",
    "secondary",
    "secondary_link",
    "tertiary",
    "tertiary_link",
    "trunk", // Not sure if that should be excluded or not
    "trunk_link",
];
const EXCLUDED_HOUSE_TAG_VALUES: [&str; 1] = ["shed"];

thread_local! {
    //static LONLAT_TO_METERS: proj::Proj = proj::Proj::new_known_crs("EPSG:4326", "EPSG:32613", None)
    //    .expect("Failed to init forward projection");
    static LONLAT_TO_ECEF: proj::Proj = proj::Proj::new_known_crs("EPSG:4326", "EPSG:4978", None)
        .expect("Failed to init ECEF projection");
    static METERS_TO_LONLAT: proj::Proj = proj::Proj::new_known_crs("EPSG:32613", "EPSG:4326", None)
        .expect("Failed to init inverse projection");

   
}

/// Usage: <executable> <input.osm.pbf> <output_walls.geojson> <output_dots.geojson>
fn main() {
    if env::args().len() != 4 {
        eprintln!("Usage: <executable> <input.osm.pbf> <output_walls.geojson> <output_dots.geojson>");
        std::process::exit(1);
    }

    let input_path = &env::args().nth(1).unwrap();
    let output_path = &env::args().nth(2).unwrap();
    let dots_path = &env::args().nth(3).unwrap();

    // Ensure the input file exists
    if !std::path::Path::new(input_path).exists() {
        eprintln!("Input file does not exist: {}", input_path);
        std::process::exit(2);
    }

    // Start a clock
    let clock = std::time::Instant::now();

    // Reader for the .osm.pbf file
    let mut osm_reader =
        osmpbf::IndexedReader::from_path(input_path).expect("Failed to read .osm.pbf file");

    // Collect roads
    let mut road_segments: Vec<geo::Line> = vec![];
    road_segments.reserve(2048); // arbitrary
    for_each_way_node_coordinates(
        &mut osm_reader,
        |way| -> bool {
            way.tags().any(|(k, v)| k == "highway" && INCLUDED_HIGHWAY_TAG_VALUES.contains(&v))
        },
        |_way: &osmpbf::Way, node_coordinates: &Vec<geo::Coord>| -> () {
            for segment in node_coordinates.windows(2) {
                road_segments.push(geo::Line::new(segment[0], segment[1]));
            }
        },
    );

    // Convert all segments to Euclidian space
    println!(
        "Gathered {:?} road segments, converting them to Euclidian space ...",
        &road_segments.len()
    );
    for s in &mut road_segments {
        s.start = project_lonlat_to_meters(s.start);
        s.end = project_lonlat_to_meters(s.end);
    }

    println!(
        "Converted {:?} road segments, creating an R-Tree ...",
        &road_segments.len()
    );
    let roads_rtree = rstar::RTree::bulk_load(road_segments);
    println!("Created a road R-Tree.");

    let find_distance_2_to_nearest_point_from = |euclidian_from: &geo::Point| -> f64 {
        // Find the single nearest road segment
        if let Some(nearest_segment) = roads_rtree.nearest_neighbor(&euclidian_from) {
            return geo::Euclidean.distance(nearest_segment, euclidian_from);
        }
        f64::NAN
    };

    // Result GeoJSON object
    let mut result = geojson::FeatureCollection::default();

    // Collect houses
    for_each_way_node_coordinates(
        &mut osm_reader,
        |way| -> bool {
            way.tags()
                .any(|(k, v)| k == "building" && !EXCLUDED_HOUSE_TAG_VALUES.contains(&v))
        },
        |_way: &osmpbf::Way, node_coordinates: &Vec<geo::Coord>| -> () {
            let mut coords = node_coordinates.clone();
            let distances: Vec<f64> = coords
                .iter()
                .map(|c| {
                    let euclidian_c = project_lonlat_to_meters(geo::Point::from(c.clone()));
                    let d = find_distance_2_to_nearest_point_from(&euclidian_c.into());
                    if d.is_nan() { 0.0 } else { d }
                })
                .collect();
            if distances.len() < 2 {
                return;
            }
            result
                .features
                .push(create_house_walls_as_linestring_feature(
                    &coords,
                    &distances,
                ));
        },
    );

    // Write walls GeoJSON
    println!("Writing walls to {:?} ...", std::path::PathBuf::from(&output_path));
    let mut geojson_file = File::create(output_path).expect("Failed to create output GEOJSON file");
    geojson_file
        .write_all(result.to_string().as_bytes())
        .expect("Failed to write into output GEOJSON file");
    drop(result); // free wall features before the centroid pass

    println!("Computing centroids from walls file, writing dots to {:?} ...", dots_path);
    let walls_file = File::open(output_path).expect("Failed to re-open walls GeoJSON");
    let mut dots = geojson::FeatureCollection::default();
    for feature in geojson::FeatureReader::from_reader(std::io::BufReader::new(walls_file)).features() {
        let feature = feature.expect("Failed to read feature from walls GeoJSON");

        let coords = match feature.geometry.as_ref().map(|g| &g.value) {
            Some(geojson::GeometryValue::LineString { coordinates }) => coordinates,
            _ => continue,
        };
        if coords.is_empty() {
            continue;
        }

        let n = coords.len() as f64;
        let cx = coords.iter().map(|c| c[0]).sum::<f64>() / n;
        let cy = coords.iter().map(|c| c[1]).sum::<f64>() / n;

        let avg_dist = feature
            .properties
            .as_ref()
            .and_then(|p| p.get("dists"))
            .and_then(|v| v.as_array())
            .map(|arr| {
                let sum: f64 = arr.iter().filter_map(|v| v.as_f64()).sum();
                sum / arr.len() as f64
            })
            .unwrap_or(0.0);

        let mut props = serde_json::Map::new();
        props.insert("avg_dist".to_string(), serde_json::json!(avg_dist));
        dots.features.push(geojson::Feature {
            bbox: None,
            geometry: Some(geojson::Geometry::new_point(vec![cx, cy])),
            id: None,
            properties: Some(props),
            foreign_members: None,
        });
    }

    let mut dots_file = File::create(&dots_path).expect("Failed to create dots GeoJSON file");
    dots_file
        .write_all(dots.to_string().as_bytes())
        .expect("Failed to write dots GeoJSON file");

    println!("Full generation took {:?}", clock.elapsed());
}

/**
 * Helper function that loops over each road from an .osm.pbf dataset.
 * @note Acceptance criterias are hardcoded in the function body.
 */
fn for_each_way_node_coordinates<P, F>(
    osm_reader: &mut osmpbf::IndexedReader<File>,
    acceptance_predicate: P,
    mut road_cb: F,
) where
    P: Fn(&osmpbf::Way) -> bool,
    F: FnMut(&osmpbf::Way, &Vec<geo::Coord>) -> (),
{
    let mut node_coordinates: Vec<geo::Coord> = vec![];
    osm_reader
        .read_ways_and_deps(
            |way| acceptance_predicate(&way),
            |element| {
                match element {
                    osmpbf::Element::Way(way) => {
                        node_coordinates.clear();
                        way.node_locations().for_each(|e| {
                            node_coordinates.push(geo::Coord::from_xy(e.lon(), e.lat()))
                        });
                        if node_coordinates.len() < 2_usize {
                            return;
                        }

                        road_cb(&way, &node_coordinates)
                    }
                    osmpbf::Element::Node(_) => (),
                    osmpbf::Element::DenseNode(_) => (),
                    osmpbf::Element::Relation(_) => panic!(), // should not occur
                }
            },
        )
        .unwrap();
}

/* UNUSED
fn create_house_wall_feature(
    start: geo::Coord,
    end: geo::Coord,
    dist_start: f64,
    dist_end: f64,
) -> geojson::Feature {
    // geometry
    let geometry =
        geojson::Geometry::new_line_string(vec![vec![start.x, start.y], vec![end.x, end.y]]);

    // properties
    let mut properties = serde_json::Map::new();
    properties.insert(
        "dist_start".to_string(),
        serde_json::Value::Number(serde_json::Number::from_f64(dist_start).unwrap()),
    );
    properties.insert(
        "dist_end".to_string(),
        serde_json::Value::Number(serde_json::Number::from_f64(dist_end).unwrap()),
    );

    geojson::Feature {
        bbox: None,
        geometry: Some(geometry),
        id: None,
        properties: Some(properties),
        foreign_members: None,
    }
}
*/

fn create_house_walls_as_linestring_feature(
    coords: &Vec<geo::Coord>,
    distances: &Vec<f64>,
) -> geojson::Feature {
    // geometry
    let geometry = geojson::Geometry::new_line_string(coords.iter().map(|e| vec![e.x, e.y]));

    // properties
    let mut properties = serde_json::Map::new();
    properties.insert(
        "dists".to_string(),
        serde_json::json!(
            distances
                .iter()
                .map(|e| serde_json::Number::from_f64(e.clone()).unwrap())
                .collect::<Vec<serde_json::Number>>()
        ),
    );

    geojson::Feature {
        bbox: None,
        geometry: Some(geometry),
        id: None,
        properties: Some(properties),
        foreign_members: None,
    }
}

#[allow(unused)]
fn project_lonlat_to_meters<T: Into<geo::Coord>>(c: T) -> geo::Coord {
    let coord: geo::Coord = c.into();
    LONLAT_TO_ECEF.with(|proj| proj.convert(coord).unwrap().into())
}

#[allow(unused)]
fn project_meters_to_lonlat<T: Into<geo::Coord>>(c: T) -> geo::Coord {
    let coord: geo::Coord = c.into();
    METERS_TO_LONLAT.with(|proj| proj.convert(coord).unwrap().into())
}
