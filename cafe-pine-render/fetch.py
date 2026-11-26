"""Download the Poly Haven assets the scene uses (all CC0) into assets/."""
import json, os, sys, urllib.request, concurrent.futures as cf

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')
UA = {'User-Agent': 'cafe-pine-render/1.0'}

MODELS = {  # id: resolution of included textures
    'pine_tree_01': '2k', 'fir_tree_01': '2k', 'fir_sapling_medium': '1k',
    'fern_02': '1k', 'grass_medium_01': '1k', 'grass_medium_02': '1k', 'shrub_02': '1k',
    'tree_stump_01': '1k', 'boulder_01': '1k', 'moss_01': '1k', 'dead_tree_trunk': '1k',
    'sofa_03': '2k', 'sofa_02': '2k', 'throw_pillows_01': '1k', 'Ottoman_01': '1k',
    'side_table_01': '1k', 'industrial_wall_lamp': '1k', 'hanging_industrial_lamp': '1k',
}
TEXTURES = {
    'wood_trunk_wall': '2k', 'stacked_stone_wall': '2k', 'forrest_ground_03': '2k', 'leafy_grass': '2k',
    'gravel': '2k', 'roof_planks': '2k', 'grey_roof_tiles': '2k', 'corrugated_iron': '1k',
    'wood_floor_deck': '2k', 'raw_plank_wall': '2k', 'dirty_carpet': '2k', 'black_walnut_veneer_02': '1k',
    'dark_planks': '1k', 'rough_linen': '1k', 'brown_leather': '1k', 'dark_wooden_planks': '2k',
}
HDRIS = {'forest_grove': '4k', 'rogland_clear_night': '2k'}
TEX_MAPS = ['Diffuse', 'nor_gl', 'Rough', 'Displacement', 'AO']

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()

def save(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    data = get(url)
    with open(path + '.part', 'wb') as f:
        f.write(data)
    os.replace(path + '.part', path)

def jobs():
    for aid, res in MODELS.items():
        files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
        b = files['blend'][res]['blend']
        base = os.path.join(ROOT, 'models', aid)
        yield b['url'], os.path.join(base, os.path.basename(b['url']))
        for rel, inc in b.get('include', {}).items():
            yield inc['url'], os.path.join(base, rel)
    for aid, res in TEXTURES.items():
        files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
        for m in TEX_MAPS:
            if m in files and res in files[m]:
                fmt = files[m][res]
                f = fmt.get('jpg') or fmt.get('png') or next(iter(fmt.values()))
                yield f['url'], os.path.join(ROOT, 'textures', aid, f'{m}.{f["url"].rsplit(".", 1)[1]}')
    for aid, res in HDRIS.items():
        files = json.loads(get(f'https://api.polyhaven.com/files/{aid}'))
        yield files['hdri'][res]['hdr']['url'], os.path.join(ROOT, 'hdri', f'{aid}.hdr')

if __name__ == '__main__':
    todo = list(jobs())
    print('files', len(todo), flush=True)
    with cf.ThreadPoolExecutor(6) as ex:
        futs = {ex.submit(save, u, p): p for u, p in todo}
        for i, f in enumerate(cf.as_completed(futs)):
            try:
                f.result()
            except Exception as e:
                print('FAIL', futs[f], e, flush=True)
            if i % 20 == 0:
                print('done', i, flush=True)
    print('ALL DONE', flush=True)
