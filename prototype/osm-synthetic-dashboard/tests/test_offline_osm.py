import hashlib,json
from pathlib import Path
import pytest
from etl.offline_osm import load_offline_osm


def dataset(tmp_path, elements):
 p=tmp_path/'osm.json';p.write_text(json.dumps({'elements':elements}))
 p.with_suffix('.manifest.json').write_text(json.dumps({'source_url':'https://api.openstreetmap.org/api/0.6/map.json?bbox=120.985,14.605,120.995,14.615','retrieved_at':'2026-11-15T00:00:00+00:00','sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'attribution':'© OpenStreetMap contributors','license':'https://opendatacommons.org/licenses/odbl/1-0/'}))
 return p

def node():
 return {'type':'node','id':123,'lat':14.6091,'lon':120.9895,'tags':{'name':'Validation fixture only','amenity':'restaurant'}}

@pytest.mark.parametrize('field,value',[('id',0),('id',True),('lat',float('nan')),('lon',181),('lat',None),('tags',{'name':'x'*161,'amenity':'restaurant'})])
def test_invalid(tmp_path,field,value):
 n=node();n[field]=value
 with pytest.raises(ValueError):load_offline_osm(dataset(tmp_path,[n]))

def test_checksum(tmp_path):
 p=dataset(tmp_path,[node()]);p.write_text('{}')
 with pytest.raises(ValueError,match='checksum'):load_offline_osm(p)

def test_conflict(tmp_path):
 n=node();other={**n,'lat':14.61}
 with pytest.raises(ValueError,match='Conflicting'):load_offline_osm(dataset(tmp_path,[n,other]))

def test_duplicates_and_required_name(tmp_path):
 n=node();unnamed={**n,'id':124,'tags':{'amenity':'cafe'}}
 places,meta=load_offline_osm(dataset(tmp_path,[n,n,unnamed]))
 assert len(places)==1 and meta['identical_duplicates_removed']==1 and meta['excluded']==1

def test_outside_ust(tmp_path):
 n=node();n['lat']=15
 with pytest.raises(ValueError,match='No named'):load_offline_osm(dataset(tmp_path,[n]))
