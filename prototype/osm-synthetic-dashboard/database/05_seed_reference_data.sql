USE blueplate_dw;

INSERT INTO dim_city (city_name, region_name, population_est, is_primary_hub) VALUES
('Manila', 'Metro Manila (NCR)', 1846513, TRUE),
('Quezon City', 'Metro Manila (NCR)', 2960048, FALSE),
('Makati', 'Metro Manila (NCR)', 629616, FALSE);

INSERT INTO dim_zone (city_key, zone_code, zone_name, barangay_name, center_lat, center_lng, radius_km, nearest_ust_gate) VALUES
(1, 'UST-ESPANA', 'UST - España Blvd & The One', 'Barangay 471 / Sampaloc', 14.6075000, 120.9899000, 0.80, 'España Gate 1 & 2'),
(1, 'UST-DAPITAN', 'UST - Dapitan St Corridor', 'Barangay 472 / Sampaloc', 14.6119000, 120.9888000, 0.80, 'Dapitan Gate 10 & 11'),
(1, 'UST-PNOVAL', 'UST - P. Noval St Food Strip', 'Barangay 466 / Sampaloc', 14.6088000, 120.9873000, 0.70, 'P. Noval Gate 7'),
(1, 'UST-LACSON', 'UST - Lacson Ave & Hospital Side', 'Barangay 474 / Sampaloc', 14.6104000, 120.9922000, 0.80, 'Lacson Gate 14');

INSERT INTO dim_cuisine (cuisine_name, cuisine_group, avg_prep_baseline_mins) VALUES
('Silog & Filipino Rice Meals', 'Filipino Comfort', 10),
('Milktea, Coffee & Shakes', 'Beverages & Cafe', 7),
('Fast Food & Burgers', 'Western Fast Food', 9),
('Korean & Samgyupsal Bowls', 'East Asian', 14),
('Pizza & Pasta', 'Western Casual', 15),
('Japanese Ramen & Donburi', 'East Asian', 13);

INSERT INTO dim_platform (platform_name, platform_type, base_url) VALUES
('Google Places API (New)', 'Directory API', 'https://places.googleapis.com/v1'),
('OpenStreetMap Overpass', 'Open Geo Data', 'https://overpass-api.de/api/interpreter'),
('Public Storefront JSON-LD Bot', 'Delivery Marketplace', 'https://www.foodpanda.ph');

INSERT INTO dim_data_source (source_code, collection_method, tos_compliance_notes, rate_limit_seconds) VALUES
('GOOGLE_PLACES_V1', 'Official REST API', 'Field-masked Nearby Search within 1.5km of UST Manila; compliant with Google Maps Platform ToS', 0.25),
('OSM_OVERPASS', 'Overpass Geo Query', 'OpenStreetMap ODbL amenity=restaurant/fast_food/cafe bounding query', 1.50),
('LEGAL_JSONLD_BOT', 'Rate-Limited Legal Bot', 'Respects robots.txt, identifies BluePlateBI-ResearchBot/1.0, 4s delay, public schema.org data only', 4.00);

INSERT INTO dim_alert_threshold (metric_code, metric_label, unit_label, comparison_direction, normal_limit, warning_limit, critical_limit) VALUES
('DELIVERY_ETA_MINS', 'Estimated Campus Delivery Time', 'mins', 'HIGHER_IS_WORSE', 28.00, 35.00, 45.00),
('CANCELLATION_PROXY_PCT', 'Cancellation Proxy Index', '%', 'HIGHER_IS_WORSE', 4.00, 8.00, 15.00),
('AVG_RATING', 'Merchant Rating Score', 'stars', 'LOWER_IS_WORSE', 4.50, 4.00, 3.60),
('PRICE_HIKE_PCT', 'Day-over-Day Menu Price Increase', '%', 'HIGHER_IS_WORSE', 3.00, 8.00, 15.00);