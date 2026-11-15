"""No database writes are allowed after unavailable or empty venue collection."""
from unittest.mock import Mock, patch
import pytest
import requests
from etl import ust_api_collector as collector
from etl import warehouse_loader as loader


def response(data):
    result = Mock()
    result.json.return_value = data
    return result


def test_outage_stops_before_database_connection():
    with patch.object(collector.requests, 'post', side_effect=requests.Timeout), patch.object(loader.mysql.connector, 'connect') as connect:
        with pytest.raises(RuntimeError, match='synthetic fallback is disabled'):
            loader.run_etl_pipeline()
        connect.assert_not_called()


@pytest.mark.parametrize('payload', [{'elements': []}, {}, {'elements': None}, [], {'elements': [], 'remark': 'runtime error'}])
def test_empty_or_invalid_mirrors_never_load_synthetic_venues(payload):
    with patch.object(collector.requests, 'post', return_value=response(payload)) as post:
        with pytest.raises(RuntimeError, match='before database writes'):
            collector.fetch_ust_eateries_osm_overpass()
        assert post.call_count == len(collector.OVERPASS_MIRRORS)


def test_empty_custom_fetcher_stops_before_database_connection():
    with patch.object(loader.mysql.connector, 'connect') as connect:
        with pytest.raises(RuntimeError, match='No venues collected'):
            loader.run_etl_pipeline(fetcher=lambda: [])
        connect.assert_not_called()


def test_empty_mirror_failover_filters_invalid_and_duplicate_nodes():
    valid = {'type': 'node', 'id': 12, 'lat': 14.61, 'lon': 120.99, 'tags': {'name': 'Test cafe', 'amenity': 'cafe'}}
    data = {'elements': [valid, valid, {**valid, 'id': 13, 'lat': 'NaN'}, {**valid, 'id': 14, 'lat': 200}, {'tags': {}}, None]}
    with patch.object(collector.requests, 'post', side_effect=[response({'elements': []}), response(data)]):
        result = collector.fetch_ust_eateries_osm_overpass()
    assert len(result) == 1
    assert result[0]['external_place_id'] == 'osm_node_12'
