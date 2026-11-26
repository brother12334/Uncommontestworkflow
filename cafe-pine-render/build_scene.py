"""Cafe Pine: builds the forest, log cabin and great room in Blender from Poly Haven assets
and renders the test shots with Cycles.

Run:  python3 build_scene.py [--shots canopy,cabin,inside,brew,night] [--scale 100] [--samples 96]
Assets come from fetch.py (assets/). Layout units are metres. Positions are written in
"three" coordinates (x right, y up, z toward the viewer) and converted with P().
"""
import bpy, bmesh, math, os, random, sys, time, json, argparse
from mathutils import Vector, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
A = os.path.join(HERE, 'assets')
OUT = os.path.join(HERE, 'renders')

def P(x, y, z):  # three (x, y-up, z-toward-viewer) -> blender (x, y-forward, z-up)
    return Vector((x, -z, y))

def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)

rng = random.Random(1127)

# ---------------------------------------------------------------- scene setup
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for c in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.objects):
        for d in list(c):
            c.remove(d)

def coll(name, parent=None):
    c = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(c)
    return c

def obj_from_bm(name, bm, mat=None, col=None, smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(o)
    if mat:
        if isinstance(mat, (list, tuple)):
            for m in mat: me.materials.append(m)
        else:
            me.materials.append(mat)
    return o

# ---------------------------------------------------------------- materials
def _img(nt, path, nonc=False, proj='BOX'):
    n = nt.nodes.new('ShaderNodeTexImage')
    n.image = bpy.data.images.load(path, check_existing=True)
    if nonc: n.image.colorspace_settings.name = 'Non-Color'
    n.projection = proj
    if proj == 'BOX': n.projection_blend = 0.3
    return n

def pbr(name, tex, tile=2.0, tint=None, hsv=(0.5, 1.0, 1.0), rough=(0.0, 1.0), uv=False, rot=(0, 0, 0), coat=0.0, bump=1.0, normal=1.0, spec=0.5):
    """Principled material from a Poly Haven texture folder, box-projected in object space (or UV)."""
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nodes = nt.nodes; links = nt.links
    bsdf = nodes['Principled BSDF']
    tc = nodes.new('ShaderNodeTexCoord')
    mp = nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1 / tile, 1 / tile, 1 / tile)
    mp.inputs['Rotation'].default_value = rot
    links.new(tc.outputs['UV' if uv else 'Object'], mp.inputs['Vector'])
    proj = 'FLAT' if uv else 'BOX'
    d = os.path.join(A, 'textures', tex)
    col = _img(nt, os.path.join(d, 'Diffuse.jpg'), proj=proj); links.new(mp.outputs[0], col.inputs[0])
    c_out = col.outputs['Color']
    h = nodes.new('ShaderNodeHueSaturation')
    h.inputs['Hue'].default_value, h.inputs['Saturation'].default_value, h.inputs['Value'].default_value = hsv
    links.new(c_out, h.inputs['Color']); c_out = h.outputs['Color']
    if tint:
        mx = nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'
        mx.inputs['Factor'].default_value = 1.0
        links.new(c_out, mx.inputs[6]); mx.inputs[7].default_value = lin(tint)
        c_out = mx.outputs[2]
    links.new(c_out, bsdf.inputs['Base Color'])
    rp = os.path.join(d, 'Rough.jpg')
    if os.path.exists(rp):
        r = _img(nt, rp, True, proj); links.new(mp.outputs[0], r.inputs[0])
        mr = nodes.new('ShaderNodeMapRange')
        mr.inputs['To Min'].default_value, mr.inputs['To Max'].default_value = rough
        links.new(r.outputs['Color'], mr.inputs['Value']); links.new(mr.outputs['Result'], bsdf.inputs['Roughness'])
    np_ = os.path.join(d, 'nor_gl.jpg')
    if os.path.exists(np_) and normal > 0:
        n = _img(nt, np_, True, proj); links.new(mp.outputs[0], n.inputs[0])
        nm = nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal
        links.new(n.outputs['Color'], nm.inputs['Color'])
        dp = os.path.join(d, 'Displacement.jpg')
        if os.path.exists(dp) and bump > 0:
            di = _img(nt, dp, True, proj); links.new(mp.outputs[0], di.inputs[0])
            b = nodes.new('ShaderNodeBump'); b.inputs['Strength'].default_value = 0.35 * bump; b.inputs['Distance'].default_value = 0.02
            links.new(di.outputs['Color'], b.inputs['Height']); links.new(nm.outputs['Normal'], b.inputs['Normal'])
            links.new(b.outputs['Normal'], bsdf.inputs['Normal'])
        else:
            links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Coat Weight'].default_value = coat
    bsdf.inputs['Specular IOR Level'].default_value = spec
    return m

def flat(name, hexc, rough=0.5, metal=0.0, coat=0.0, emit=None, emit_str=0.0, transmission=0.0, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(hexc)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['Alpha'].default_value = alpha
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit)
        b.inputs['Emission Strength'].default_value = emit_str
    return m

# ---------------------------------------------------------------- geometry helpers
def bm_box(bm, c, size, rot=None):
    m = Matrix.Translation(c)
    if rot is not None: m = m @ rot.to_matrix().to_4x4()
    m = m @ Matrix.Diagonal((size[0], size[1], size[2], 1))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)

def bm_cyl(bm, a, b, r, seg=24, uv_tile=1.0, r2=None):
    """Cylinder from a to b with UVs: u along length, v around."""
    a, b = Vector(a), Vector(b)
    axis = (b - a); L = axis.length; axis.normalize()
    t1 = axis.orthogonal().normalized(); t2 = axis.cross(t1)
    uvl = bm.loops.layers.uv.verify()
    r2 = r if r2 is None else r2
    rings = []
    for end, rad in ((a, r), (b, r2)):
        ring = []
        for i in range(seg + 1):
            ang = 2 * math.pi * i / seg
            ring.append(bm.verts.new(end + (t1 * math.cos(ang) + t2 * math.sin(ang)) * rad))
        rings.append(ring)
    circ = 2 * math.pi * r
    for i in range(seg):
        f = bm.faces.new((rings[0][i], rings[0][i + 1], rings[1][i + 1], rings[1][i]))
        uvs = [(0, i / seg * circ), (0, (i + 1) / seg * circ), (L, (i + 1) / seg * circ), (L, i / seg * circ)]
        for lp, uv in zip(f.loops, uvs): lp[uvl].uv = (uv[0] / uv_tile, uv[1] / uv_tile)
    for ring, flip in ((rings[0], True), (rings[1], False)):
        vs = ring[:-1]
        f = bm.faces.new(list(reversed(vs)) if flip else vs)
        for lp in f.loops:
            co = lp.vert.co - (a if flip else b)
            lp[uvl].uv = (co.dot(t1) / uv_tile * 0.5, co.dot(t2) / uv_tile * 0.5)

def poly_extrude(bm, pts2d, z0, z1, to3d):
    """Extrude a 2D outline (list of (u,v)) between heights z0..z1 through mapping to3d(u, v, h)."""
    bot = [bm.verts.new(to3d(u, v, z0)) for u, v in pts2d]
    top = [bm.verts.new(to3d(u, v, z1)) for u, v in pts2d]
    bm.faces.new(list(reversed(bot))); bm.faces.new(top)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))

def link_asset(blend, names=None, kind='collections', want=None):
    path = os.path.join(A, 'models', blend)
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        items = getattr(src, kind)
        setattr(dst, kind, [n for n in items if (want is None or want(n))])
    return getattr(dst, kind)

def make_proto(objs, name, hidden):
    """Collection holding objects as an instancing prototype (not rendered directly)."""
    c = bpy.data.collections.new(name)
    hidden.children.link(c)
    for o in objs:
        for uc in list(o.users_collection): uc.objects.unlink(o)
        c.objects.link(o)
    return c

def instance(proto, loc, rot_z=0.0, scale=1.0, col=None, name='inst'):
    e = bpy.data.objects.new(name, None)
    e.instance_type = 'COLLECTION'; e.instance_collection = proto
    e.location = loc; e.rotation_euler = (0, 0, rot_z); e.scale = (scale, scale, scale)
    (col or bpy.context.scene.collection).objects.link(e)
    return e

# ---------------------------------------------------------------- layout constants (three coords)
FLOOR, EAVE, RIDGE = 1.4, 4.4, 7.9
X0, X1, Z0, Z1 = -4.5, 4.5, -7.0, 4.0
WX0, WZ0, WZ1, WEAVE, WRIDGE = -8.0, -5.0, 1.0, 4.1, 5.3
DECK_Z, DECK_X, RDECK_Z0 = 6.2, 6.7, -0.5
DOOR = (0.82, 1.78, 2.05)
STAIR = (-3.3, -2.1)
RSTAIR = (2.4, 3.6)
PITCH = math.atan2(RIDGE - EAVE, 4.5)
DRIVE = [(-16, 44), (-13.5, 30), (-10.5, 20), (-8.6, 13), (-8.2, 8), (-8.6, 4.5)]

def seg_dist(px, pz, a, b):
    dx, dz = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)))
    return math.hypot(px - (a[0] + dx * t), pz - (a[1] + dz * t))

def drive_dist(x, z):
    return min(seg_dist(x, z, DRIVE[i], DRIVE[i + 1]) for i in range(len(DRIVE) - 1))

def ground_h(x, z):
    r = math.hypot(x + 1, z - 2)
    n = noise.noise(Vector((x * 0.035, z * 0.035, 0.3))) * 2.4 + noise.noise(Vector((x * 0.09, z * 0.09, 1.7))) * 0.6
    k = min(1, max(0, (r - 22) / 33)); k = k * k * (3 - 2 * k)
    lawn = -0.012 * max(0, z - 6) * max(0, 1 - max(0, r - 12) / 18)
    return n * 1.6 * k + lawn

def lawn_w(x, z):
    d = math.hypot((x + 3) / 12.5, (z - 10.5) / 9.5)
    return max(0.0, min(1.0, (1.15 - d) / 0.3))

# ---------------------------------------------------------------- world, lights, render
def setup_render(scale, samples):
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    cy = s.cycles
    cy.device = 'CPU'
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.denoiser = 'OPENIMAGEDENOISE'
    cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    cy.max_bounces = 8
    cy.diffuse_bounces = 3; cy.glossy_bounces = 3; cy.transmission_bounces = 8; cy.volume_bounces = 0
    cy.transparent_max_bounces = 32
    cy.sample_clamp_indirect = 8.0
    cy.light_sampling_threshold = 0.01
    cy.use_light_tree = True
    s.render.use_persistent_data = True
    s.render.resolution_x, s.render.resolution_y = 1280, 720
    s.render.resolution_percentage = scale
    s.render.film_transparent = False
    s.render.image_settings.file_format = 'PNG'
    s.view_settings.view_transform = 'AgX'
    looks = [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['look'].enum_items_static] if False else None
    for look in ('AgX - Medium High Contrast', 'Medium High Contrast', 'None'):
        try:
            s.view_settings.look = look; break
        except TypeError:
            continue

def setup_world(kind):
    w = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
    bpy.context.scene.world = w
    w.use_nodes = True
    nt = w.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputWorld')
    bg = nt.nodes.new('ShaderNodeBackground')
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    nt.links.new(tc.outputs['Generated'], mp.inputs['Vector']); nt.links.new(mp.outputs[0], env.inputs[0])
    nt.links.new(env.outputs['Color'], bg.inputs['Color']); nt.links.new(bg.outputs[0], out.inputs['Surface'])
    if kind == 'day':
        env.image = bpy.data.images.load(os.path.join(A, 'hdri', 'forest_grove.hdr'), check_existing=True)
        mp.inputs['Rotation'].default_value = (0, 0, math.radians(-31))
        bg.inputs['Strength'].default_value = 1.0
    else:
        env.image = bpy.data.images.load(os.path.join(A, 'hdri', 'rogland_clear_night.hdr'), check_existing=True)
        mp.inputs['Rotation'].default_value = (0, 0, math.radians(40))
        bg.inputs['Strength'].default_value = 0.25
    w.cycles.sampling_method = 'MANUAL'; w.cycles.sample_map_resolution = 2048
    return w

# ---------------------------------------------------------------- build
def build():
    reset()
    scn = bpy.context.scene
    hidden = coll('_protos'); hidden.hide_render = True; hidden.hide_viewport = True
    C_env = coll('SET_forest'); C_cab = coll('SET_cabin'); C_in = coll('SET_interior'); C_lt = coll('LIGHTS')

    # ---------- materials ----------
    M = {}
    M['ground'] = ground_material()
    M['log'] = pbr('log', 'wood_trunk_wall', tile=1.2, uv=True, rot=(0, 0, math.radians(90)), hsv=(0.5, 1.25, 1.45), tint='#E0A870', rough=(0.55, 0.85))
    M['chink'] = flat('chinking', '#2E241C', 0.95)
    M['roof'] = pbr('roof', 'grey_roof_tiles', tile=2.0, rot=(0, 0, math.radians(90)), rough=(0.6, 1.0))
    M['metal'] = pbr('metal_roof', 'corrugated_iron', tile=1.5, tint='#7FA4A0', hsv=(0.5, 0.4, 1.0), rough=(0.35, 0.6))
    M['metal'].node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value = 0.6
    M['soffit'] = pbr('soffit', 'roof_planks', tile=2.0, rough=(0.5, 0.8))
    M['shingle'] = shingle_material()
    M['underlay'] = flat('underlay', '#1E1D1C', 0.9)
    M['deck'] = pbr('deck', 'dark_wooden_planks', tile=2.0, hsv=(0.5, 1.0, 1.15), rough=(0.6, 0.9))
    M['black'] = flat('black_metal', '#1A1918', 0.45, 0.2)
    M['trim'] = pbr('trim', 'dark_planks', tile=1.0, hsv=(0.5, 0.8, 0.8), rough=(0.5, 0.8))
    M['block'] = pbr('foundation', 'stacked_stone_wall', tile=1.4, hsv=(0.5, 0.35, 0.55), rough=(0.7, 1.0))
    M['glass'] = flat('glass', '#E8EEF0', 0.02, transmission=1.0)
    M['glass'].node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value = 1.5
    M['walls'] = pbr('walls', 'raw_plank_wall', tile=2.5, rot=(0, math.radians(90), math.radians(90)), rough=(0.55, 0.85))
    M['ceiling'] = pbr('ceiling', 'roof_planks', tile=2.0, hsv=(0.5, 0.85, 1.15), rough=(0.5, 0.8))
    M['beam'] = pbr('beam', 'dark_planks', tile=1.5, tint='#6A4A30', hsv=(0.5, 1.0, 0.7), rough=(0.45, 0.75))
    M['carpet'] = pbr('carpet', 'dirty_carpet', tile=1.5, tint='#8C9480', hsv=(0.5, 0.5, 0.9), rough=(0.85, 1.0))
    M['stone'] = pbr('stone', 'stacked_stone_wall', tile=1.6, hsv=(0.5, 0.85, 1.05), rough=(0.6, 0.95), bump=2.5, normal=1.5)
    M['walnut'] = pbr('walnut', 'black_walnut_veneer_02', tile=1.0, uv=True, rough=(0.25, 0.45), coat=0.3)
    M['felt'] = flat('felt', '#8E1F22', 0.95)
    M['linen'] = pbr('linen', 'rough_linen', tile=0.4, tint='#F2E6D0', hsv=(0.5, 0.3, 1.2), rough=(0.8, 1.0))
    M['rug'] = pbr('rug', 'rough_linen', tile=0.6, tint='#E0D4BE', hsv=(0.5, 0.3, 1.1), rough=(0.85, 1.0))
    M['brass'] = flat('brass', '#C9A060', 0.3, 1.0)
    M['steel'] = flat('steel', '#D8D8D6', 0.18, 1.0)
    M['iron'] = flat('iron', '#1E1D1B', 0.45, 0.85)
    M['kraft'] = flat('kraft', '#A88258', 0.85)
    M['label'] = flat('label', '#EEE4CE', 0.7)
    M['soot'] = flat('soot', '#0E0C0B', 1.0)
    M['char'] = char_material()
    M['flame'] = flame_material()
    M['glaze'] = flat('glaze', '#1F3A2A', 0.3, coat=0.7)
    M['clay'] = flat('clay_rim', '#D9C7A8', 0.6)
    M['inner'] = flat('glaze_inner', '#E6DCCB', 0.25, coat=0.4)
    M['shade'] = flat('lamp_shade', '#F2E6D0', 0.9, emit='#FFC98A', emit_str=6.0)
    M['shade'].node_tree.nodes['Principled BSDF'].inputs['Transmission Weight'].default_value = 0.0
    M['bulb'] = flat('bulb', '#FFFFFF', 0.3, emit='#FFC27A', emit_str=40.0)
    M['sign'] = flat('sign_letters', '#EADCBC', 0.6)

    build_ground(C_env, M)
    build_forest(C_env, hidden)
    build_cabin(C_cab, M)
    build_interior(C_in, M, hidden)
    build_lights(C_lt)
    return M

def ground_material():
    m = bpy.data.materials.new('ground'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    bsdf = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    def layer(tex, tile, hsv=(0.5, 1, 1)):
        mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1 / tile,) * 3
        Lk.new(tc.outputs['Object'], mp.inputs[0])
        d = os.path.join(A, 'textures', tex)
        c = _img(nt, os.path.join(d, 'Diffuse.jpg'), proj='FLAT'); Lk.new(mp.outputs[0], c.inputs[0])
        hs = N.new('ShaderNodeHueSaturation'); hs.inputs['Hue'].default_value, hs.inputs['Saturation'].default_value, hs.inputs['Value'].default_value = hsv
        Lk.new(c.outputs[0], hs.inputs['Color'])
        r = _img(nt, os.path.join(d, 'Rough.jpg'), True, 'FLAT'); Lk.new(mp.outputs[0], r.inputs[0])
        n = _img(nt, os.path.join(d, 'nor_gl.jpg'), True, 'FLAT'); Lk.new(mp.outputs[0], n.inputs[0])
        return hs.outputs[0], r.outputs[0], n.outputs[0]
    f = layer('forrest_ground_03', 3.0, (0.5, 1.15, 0.42))
    g = layer('leafy_grass', 2.5, (0.5, 1.1, 0.42))
    v = layer('gravel', 2.0, (0.5, 0.55, 1.15))
    attr = N.new('ShaderNodeAttribute'); attr.attribute_name = 'mask'
    sep = N.new('ShaderNodeSeparateColor'); Lk.new(attr.outputs['Color'], sep.inputs[0])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1.2; nz.inputs['Detail'].default_value = 6
    Lk.new(tc.outputs['Object'], nz.inputs['Vector'])
    def edge(ch):
        add = N.new('ShaderNodeMath'); add.operation = 'ADD'
        sub = N.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = 0.5
        Lk.new(nz.outputs['Fac'], sub.inputs[0])
        mul = N.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 0.9
        Lk.new(sub.outputs[0], mul.inputs[0])
        Lk.new(ch, add.inputs[0]); Lk.new(mul.outputs[0], add.inputs[1])
        mr = N.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.4; mr.inputs['From Max'].default_value = 0.6
        Lk.new(add.outputs[0], mr.inputs['Value'])
        return mr.outputs['Result']
    kg, kv = edge(sep.outputs['Red']), edge(sep.outputs['Green'])
    def mix(a, b, k, dt='RGBA'):
        mx = N.new('ShaderNodeMix'); mx.data_type = dt
        Lk.new(k, mx.inputs['Factor'])
        if dt == 'RGBA': Lk.new(a, mx.inputs[6]); Lk.new(b, mx.inputs[7]); return mx.outputs[2]
        Lk.new(a, mx.inputs[4]); Lk.new(b, mx.inputs[5]); return mx.outputs[1]
    col = mix(mix(f[0], g[0], kg), v[0], kv)
    rgh = mix(mix(f[1], g[1], kg), v[1], kv)
    nrm = mix(mix(f[2], g[2], kg), v[2], kv)
    Lk.new(col, bsdf.inputs['Base Color'])
    Lk.new(rgh, bsdf.inputs['Roughness'])
    nm = N.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = 1.2
    Lk.new(nrm, nm.inputs['Color']); Lk.new(nm.outputs[0], bsdf.inputs['Normal'])
    return m

def shingle_material():
    m = bpy.data.materials.new('asphalt_shingle'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    b = N['Principled BSDF']
    at = N.new('ShaderNodeAttribute'); at.attribute_name = 'tone'
    ramp = N.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = lin('#2B2A28'); ramp.color_ramp.elements[1].color = lin('#4A443D')
    e = ramp.color_ramp.elements.new(0.7); e.color = lin('#3A3530')
    Lk.new(at.outputs['Fac'], ramp.inputs[0])
    tc = N.new('ShaderNodeTexCoord')
    gr = N.new('ShaderNodeTexNoise'); gr.inputs['Scale'].default_value = 900; gr.inputs['Detail'].default_value = 2
    Lk.new(tc.outputs['Object'], gr.inputs['Vector'])
    lich = N.new('ShaderNodeTexNoise'); lich.inputs['Scale'].default_value = 6; lich.inputs['Detail'].default_value = 8
    Lk.new(tc.outputs['Object'], lich.inputs['Vector'])
    lm = N.new('ShaderNodeMapRange'); lm.inputs['From Min'].default_value = 0.6; lm.inputs['From Max'].default_value = 0.68
    Lk.new(lich.outputs['Fac'], lm.inputs['Value'])
    gm = N.new('ShaderNodeMix'); gm.data_type = 'RGBA'; gm.blend_type = 'MULTIPLY'; gm.inputs['Factor'].default_value = 0.35
    Lk.new(ramp.outputs[0], gm.inputs[6]); Lk.new(gr.outputs['Color'], gm.inputs[7])
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    Lk.new(lm.outputs['Result'], mx.inputs['Factor']); Lk.new(gm.outputs[2], mx.inputs[6]); mx.inputs[7].default_value = lin('#6E6A3E')
    Lk.new(mx.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.88
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.35; bp.inputs['Distance'].default_value = 0.002
    Lk.new(gr.outputs['Fac'], bp.inputs['Height']); Lk.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def char_material():
    m = bpy.data.materials.new('char_logs'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    b = N['Principled BSDF']; b.inputs['Base Color'].default_value = lin('#16110E'); b.inputs['Roughness'].default_value = 0.9
    v = N.new('ShaderNodeTexVoronoi'); v.inputs['Scale'].default_value = 18
    cr = N.new('ShaderNodeValToRGB'); cr.color_ramp.elements[0].position = 0.0; cr.color_ramp.elements[1].position = 0.06
    cr.color_ramp.elements[0].color = (1, 1, 1, 1); cr.color_ramp.elements[1].color = (0, 0, 0, 1)
    Lk.new(v.outputs['Distance'], cr.inputs[0])
    Lk.new(cr.outputs[0], b.inputs['Emission Strength'])
    b.inputs['Emission Color'].default_value = lin('#FF5A14')
    mul = N.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 6.0
    Lk.new(cr.outputs[0], mul.inputs[0]); Lk.new(mul.outputs[0], b.inputs['Emission Strength'])
    return m

def flame_material():
    m = bpy.data.materials.new('flame'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    N.clear()
    out = N.new('ShaderNodeOutputMaterial')
    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['UV'], sep.inputs[0])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 4.0; nz.inputs['Detail'].default_value = 4
    Lk.new(tc.outputs['UV'], nz.inputs['Vector'])
    # teardrop: width shrinks with height, warped by noise
    dx = N.new('ShaderNodeMath'); dx.operation = 'SUBTRACT'; dx.inputs[1].default_value = 0.5; Lk.new(sep.outputs['X'], dx.inputs[0])
    nz2 = N.new('ShaderNodeMath'); nz2.operation = 'SUBTRACT'; nz2.inputs[1].default_value = 0.5; Lk.new(nz.outputs['Fac'], nz2.inputs[0])
    warp = N.new('ShaderNodeMath'); warp.operation = 'MULTIPLY_ADD'; Lk.new(nz2.outputs[0], warp.inputs[0]); Lk.new(sep.outputs['Y'], warp.inputs[1]); Lk.new(dx.outputs[0], warp.inputs[2])
    ab = N.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; Lk.new(warp.outputs[0], ab.inputs[0])
    w = N.new('ShaderNodeMath'); w.operation = 'MULTIPLY_ADD'; w.inputs[1].default_value = -0.45; w.inputs[2].default_value = 0.5
    Lk.new(sep.outputs['Y'], w.inputs[0])
    sh = N.new('ShaderNodeMath'); sh.operation = 'SUBTRACT'; Lk.new(w.outputs[0], sh.inputs[0]); Lk.new(ab.outputs[0], sh.inputs[1])
    mr = N.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.0; mr.inputs['From Max'].default_value = 0.22
    Lk.new(sh.outputs[0], mr.inputs['Value'])
    bb = N.new('ShaderNodeBlackbody'); bb.inputs[0].default_value = 1500
    cr = N.new('ShaderNodeValToRGB')
    cr.color_ramp.elements[0].color = lin('#B83A08'); cr.color_ramp.elements[1].color = lin('#FFC070')
    Lk.new(mr.outputs['Result'], cr.inputs[0])
    em = N.new('ShaderNodeEmission'); Lk.new(cr.outputs[0], em.inputs['Color'])
    st = N.new('ShaderNodeMath'); st.operation = 'MULTIPLY'; st.inputs[1].default_value = 14.0
    Lk.new(mr.outputs['Result'], st.inputs[0]); Lk.new(st.outputs[0], em.inputs['Strength'])
    tr = N.new('ShaderNodeBsdfTransparent')
    mx = N.new('ShaderNodeMixShader'); Lk.new(mr.outputs['Result'], mx.inputs[0]); Lk.new(tr.outputs[0], mx.inputs[1]); Lk.new(em.outputs[0], mx.inputs[2])
    Lk.new(mx.outputs[0], out.inputs['Surface'])
    return m

def build_ground(col, M):
    size, res = 170, 170
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=res, y_segments=res, size=size / 2)
    # finer grid near the cabin for the gravel and lawn edges
    mask = bm.loops.layers.color.new('mask')
    for v in bm.verts:
        x, z = v.co.x, -v.co.y
        v.co.z = ground_h(x, z)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if all(abs(v.co.x + 1) < 30 and abs(-v.co.y - 6) < 30 for v in e.verts)], cuts=3, use_grid_fill=True)
    for v in bm.verts:
        x, z = v.co.x, -v.co.y
        v.co.z = ground_h(x, z)
    for f in bm.faces:
        for lp in f.loops:
            x, z = lp.vert.co.x, -lp.vert.co.y
            dd = drive_dist(x, z)
            path = seg_dist(x, z, (-8.4, 6), (-6.5, 8.6)) if True else 9
            path = min(path, seg_dist(x, z, (-6.5, 8.6), (-4.2, 9.2)), seg_dist(x, z, (-4.2, 9.2), (-2.7, 8.6)))
            g = max(0, min(1, (1.75 - dd) / 0.35)) if dd < 2.2 else 0
            g = max(g, max(0, min(1, (0.85 - path) / 0.25)))
            l = lawn_w(x, z) * (1 - g)
            lp[mask] = (l, g, 0, 1)
    o = obj_from_bm('SET_ground', bm, M['ground'], col, smooth=True)
    return o

def build_forest(col, hidden):
    # tree prototypes: three variants per species, LOD1 near, LOD2 far
    protos = {}
    for blend, pre in (('pine_tree_01/pine_tree_01_2k.blend', 'pine_tree_01'), ('fir_tree_01/fir_tree_01_2k.blend', 'fir_tree_01')):
        cols = link_asset(blend, want=lambda n, pre=pre: n in (f'{pre}_LOD1', f'{pre}_LOD2'))
        for c in cols:
            lod = c.name[-4:]
            for o in list(c.objects):
                base = o.location.copy()
                p = make_proto([o], f'P_{o.name}', hidden)
                p.instance_offset = base
                protos.setdefault((pre, lod), []).append(p)
    sap = link_asset('fir_sapling_medium/fir_sapling_medium_1k.blend', want=lambda n: n == 'fir_sapling_medium_LOD1')
    saps = []
    for o in list(sap[0].objects):
        p = make_proto([o], f'P_{o.name}', hidden); p.instance_offset = o.location.copy(); saps.append(p)
    shr = link_asset('shrub_02/shrub_02_1k.blend', want=lambda n: n == 'shrub_02_LOD1')
    shrubs = []
    for o in list(shr[0].objects):
        p = make_proto([o], f'P_{o.name}', hidden); p.instance_offset = o.location.copy(); shrubs.append(p)
    fern = link_asset('fern_02/fern_02_1k.blend', want=lambda n: n == 'fern_02')
    ferns = []
    for o in list(fern[0].objects):
        p = make_proto([o], f'P_{o.name}', hidden); p.instance_offset = o.location.copy(); ferns.append(p)

    trees = []
    def ok(x, z, gap):
        if -11 < x < 11 and -10.5 < z < 10.5: return False
        if math.hypot((x + 3) / 12, (z - 11) / 9) < 1: return False
        if drive_dist(x, z) < 3.6: return False
        if seg_dist(x, z, (6, 40), (-2, 26)) < 4 or seg_dist(x, z, (-2, 26), (-8.5, 19)) < 4: return False
        return all(math.hypot(t[0] - x, t[1] - z) > gap for t in trees)
    for (rmin, rmax, n, gap, lod) in ((10, 48, 150, 3.6, 'LOD1'), (48, 125, 360, 4.4, 'LOD2')):
        tries = 0; placed = 0
        while placed < n and tries < 30000:
            tries += 1
            a = rng.random() * math.tau; d = rmin + (rmax - rmin) * rng.random() ** 0.85
            x, z = -1 + math.cos(a) * d, 2 + math.sin(a) * d
            if not ok(x, z, gap): continue
            sp = 'pine_tree_01' if rng.random() < 0.62 else 'fir_tree_01'
            p = rng.choice(protos[(sp, lod)])
            s = rng.uniform(0.85, 1.35) if sp == 'pine_tree_01' else rng.uniform(0.9, 1.4)
            instance(p, P(x, ground_h(x, z) - 0.05, z), rng.random() * math.tau, s, col, f'TREE_{sp}')
            trees.append((x, z)); placed += 1
    # understory saplings, shrubs and ferns at the forest edge
    for i in range(70):
        a = rng.random() * math.tau; d = rng.uniform(11, 40)
        x, z = -1 + math.cos(a) * d, 2 + math.sin(a) * d
        if not ok(x, z, 1.8): continue
        instance(rng.choice(saps), P(x, ground_h(x, z), z), rng.random() * math.tau, rng.uniform(0.35, 0.7), col, 'SAPLING')
    for i in range(160):
        a = rng.random() * math.tau; d = rng.uniform(9.5, 30)
        x, z = -1 + math.cos(a) * d, 2 + math.sin(a) * d
        if not ok(x, z, 0.0): continue
        if rng.random() < 0.55:
            instance(rng.choice(ferns), P(x, ground_h(x, z), z), rng.random() * math.tau, rng.uniform(0.8, 1.3), col, 'FERN')
        else:
            instance(rng.choice(shrubs), P(x, ground_h(x, z), z), rng.random() * math.tau, rng.uniform(0.7, 1.2), col, 'SHRUB')
    # arborvitae-like conifers along the deck (fir saplings, trimmed small)
    for x, z, s in ((-0.6, 6.95, 0.2), (1.9, 6.95, 0.22), (4.4, 6.95, 0.21)):
        instance(saps[0], P(x, ground_h(x, z), z), rng.random() * math.tau, s, col, 'SHRUB_deck')
    # stump, boulders
    st = link_asset('tree_stump_01/tree_stump_01_1k.blend', kind='objects')
    for o in st:
        col.objects.link(o); o.location = P(-12.5, ground_h(-12.5, 9.5), 9.5); o.scale = (1.2, 1.2, 1.2)
    bo = link_asset('boulder_01/boulder_01_1k.blend', kind='objects', want=lambda n: n.endswith('LOD1'))
    bp = make_proto(bo, 'P_boulder', hidden)
    for x, z, s in ((-14, 4, 0.9), (10, 15, 0.6), (13, -3, 1.1), (-12, -9, 0.8), (4, 17.5, 0.45), (-17, 15, 1.0)):
        instance(bp, P(x, ground_h(x, z) - 0.1, z), rng.random() * 6, s, col, 'BOULDER')
    # lawn grass via geometry nodes
    grass_gn(col, hidden)

def grass_gn(col, hidden):
    gcols = link_asset('grass_medium_01/grass_medium_01_1k.blend', want=lambda n: n == 'grass_medium_01_LOD1')
    gproto = make_proto(list(gcols[0].objects), 'P_grass', hidden)
    for o in gproto.objects:
        o.location = (0, 0, 0)
    # a lawn patch mesh to scatter on
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=90, y_segments=70, size=1)
    for v in bm.verts:
        x = -3 + v.co.x * 15; z = 10.5 + v.co.y * 11
        v.co = P(x, ground_h(x, z), z)
    me_o = obj_from_bm('SET_lawn_scatter', bm, None, col)
    dens = me_o.data.attributes.new('dens', 'FLOAT', 'POINT')
    for i, v in enumerate(me_o.data.vertices):
        x, z = v.co.x, -v.co.y
        w = lawn_w(x, z)
        if -8.25 < x < 4.75 and -7.25 < z < 4.2: w = 0   # cabin + wing footprint
        if -4.6 < x < 6.85 and 3.9 < z < 6.3: w = 0      # front deck
        if 4.4 < x < 6.85 and -0.6 < z < 4.2: w = 0      # right deck
        if -3.45 < x < -1.95 and 6.2 < z < 8.4: w = 0    # front stairs
        if 6.7 < x < 8.95 and 2.25 < z < 3.75: w = 0     # right stairs
        if drive_dist(x, z) < 2.0 or seg_dist(x, z, (-6.5, 8.6), (-2.7, 8.6)) < 1.0: w = 0
        dens.data[i].value = w
    ng = bpy.data.node_groups.new('lawn_grass', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, Lk = ng.nodes, ng.links
    gi = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
    dist = N.new('GeometryNodeDistributePointsOnFaces'); dist.distribute_method = 'RANDOM'
    dist.inputs['Density'].default_value = 1.0
    attr = N.new('GeometryNodeInputNamedAttribute'); attr.data_type = 'FLOAT'; attr.inputs['Name'].default_value = 'dens'
    mul = N.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 420.0
    Lk.new(attr.outputs['Attribute'], mul.inputs[0]); Lk.new(mul.outputs[0], dist.inputs['Density'])
    Lk.new(gi.outputs[0], dist.inputs['Mesh'])
    ci = N.new('GeometryNodeCollectionInfo'); ci.inputs['Collection'].default_value = gproto
    ci.inputs['Separate Children'].default_value = True; ci.inputs['Reset Children'].default_value = True
    iop = N.new('GeometryNodeInstanceOnPoints'); iop.inputs['Pick Instance'].default_value = True
    def sock(sockets, name, typ):
        return next(x for x in sockets if x.name == name and x.type == typ and x.enabled)
    rv = N.new('FunctionNodeRandomValue'); rv.data_type = 'FLOAT_VECTOR'
    sock(rv.inputs, 'Min', 'VECTOR').default_value = (0, 0, 0); sock(rv.inputs, 'Max', 'VECTOR').default_value = (0, 0, math.tau)
    rs = N.new('FunctionNodeRandomValue'); rs.data_type = 'FLOAT'
    sock(rs.inputs, 'Min', 'VALUE').default_value = 1.0; sock(rs.inputs, 'Max', 'VALUE').default_value = 1.7
    ri = N.new('FunctionNodeRandomValue'); ri.data_type = 'INT'
    sock(ri.inputs, 'Min', 'INT').default_value = 0; sock(ri.inputs, 'Max', 'INT').default_value = 100
    Lk.new(dist.outputs['Points'], iop.inputs['Points']); Lk.new(ci.outputs[0], iop.inputs['Instance'])
    Lk.new(sock(rv.outputs, 'Value', 'VECTOR'), iop.inputs['Rotation']); Lk.new(sock(rs.outputs, 'Value', 'VALUE'), iop.inputs['Scale']); Lk.new(sock(ri.outputs, 'Value', 'INT'), iop.inputs['Instance Index'])
    Lk.new(iop.outputs[0], go.inputs[0])
    mod = me_o.modifiers.new('grass', 'NODES'); mod.node_group = ng

# ---------------------------------------------------------------- cabin
def build_cabin(col, M):
    bm = bmesh.new()
    RAD = 0.11
    holes_front = [(DOOR[0] - .06, DOOR[1] + .06, FLOOR, FLOOR + DOOR[2] + .06), (-2.66, -0.84, FLOOR + .84, FLOOR + 2.16), (-0.66, 0.66, 5.04, 6.16)]
    holes_right = [(-2.36, -1.04, FLOOR + .84, FLOOR + 2.06)]  # in blender y along the wall (y = -z)
    holes_back = [(2.34, 3.46, FLOOR + .94, FLOOR + 2.06)]
    holes_wing = [(-7.26, -5.74, FLOOR + .84, FLOOR + 2.06)]
    def row(axis, fixed, a0, a1, y, holes):
        segs = [(a0, a1)]
        for h0, h1, y0, y1 in holes:
            if y < y0 - RAD or y > y1 + RAD: continue
            nxt = []
            for s, e in segs:
                if h1 <= s or h0 >= e: nxt.append((s, e)); continue
                if h0 > s: nxt.append((s, h0))
                if h1 < e: nxt.append((h1, e))
            segs = nxt
        for s, e in segs:
            if e - s < 0.05: continue
            r = RAD * rng.uniform(0.93, 1.06)
            if axis == 'x': bm_cyl(bm, P(s, y, fixed), P(e, y, fixed), r, 20, 1.2)
            else: bm_cyl(bm, Vector((fixed, s, y)), Vector((fixed, e, y)), r, 20, 1.2)  # blender y directly
    for i in range(15):
        y = FLOOR + 0.11 + i * 0.2
        row('x', Z1, X0 - .32, X1 + .32, y, holes_front)
        row('x', Z0, X0 - .32, X1 + .32, y, holes_back)
        row('z', X1, -(Z1 + .32), -(Z0 - .32), y + 0.1, holes_right)
        row('z', X0, -(Z1 + .32), -(Z0 - .32), y + 0.1, [])
    y = EAVE + 0.11
    while y < RIDGE - 0.15:
        hl = 4.5 * (RIDGE - y) / (RIDGE - EAVE) - 0.04
        row('x', Z1, -hl, hl, y, holes_front); row('x', Z0, -hl, hl, y, [])
        y += 0.2
    for i in range(14):
        y = FLOOR + 0.11 + i * 0.2
        if y > WEAVE: break
        row('x', WZ1, WX0 - .32, X0 - .1, y, holes_wing)
        row('x', WZ0, WX0 - .32, X0 - .1, y, [])
        row('z', WX0, -(WZ1 + .32), -(WZ0 - .32), y + 0.1, [(1.4, 2.6, FLOOR + .84, FLOOR + 2.06)])
    y = WEAVE + 0.11
    while y < WRIDGE - 0.1:
        hl = 1.75 * (WRIDGE - y) / (WRIDGE - WEAVE) - 0.04
        row('x', WZ1, -6.25 - hl, -6.25 + hl, y, []); row('x', WZ0, -6.25 - hl, -6.25 + hl, y, [])
        y += 0.2
    logs = obj_from_bm('CAB_logs', bm, M['log'], col, smooth=True)

    # chinking cores behind the logs (simple slabs; openings are covered by frames/glass)
    bm = bmesh.new()
    def slab_gable(zc, x0, x1, eave, ridge, cx):
        pts = [(x0, FLOOR), (x1, FLOOR), (x1, eave), (cx, ridge - 0.1), (x0, eave)]
        poly_extrude(bm, pts, zc - 0.07, zc + 0.07, lambda u, v, h: P(u, v, h))
    slab_gable(Z1, X0, X1, EAVE, RIDGE, 0); slab_gable(Z0, X0, X1, EAVE, RIDGE, 0)
    slab_gable(WZ1, WX0, X0, WEAVE, WRIDGE, -6.25); slab_gable(WZ0, WX0, X0, WEAVE, WRIDGE, -6.25)
    for xc, z0, z1, top in ((X1, Z0, Z1, EAVE), (X0, Z0, Z1, EAVE), (WX0, WZ0, WZ1, WEAVE)):
        bm_box(bm, P(xc, (FLOOR + top) / 2, (z0 + z1) / 2), (0.14, z1 - z0, top - FLOOR))
    chink = obj_from_bm('CAB_chinking', bm, M['chink'], col)
    cut_openings(chink, holes_front, holes_back, holes_right, holes_wing)

    # foundation
    bm = bmesh.new()
    bm_box(bm, P(0, (FLOOR - 0.2) / 2, (Z0 + Z1) / 2), (9.3, 11.3, FLOOR + 0.2))
    bm_box(bm, P(-6.25, (FLOOR - 0.2) / 2, -2), (3.7, 6.3, FLOOR + 0.2))
    obj_from_bm('CAB_foundation', bm, M['block'], col)

    # roofs
    def roof(cx, ridge, halfw, eave, z0, z1, over, mat, name, shingles):
        pitch = math.atan2(ridge - eave, halfw)
        run = halfw + over
        slope_len = run / math.cos(pitch)
        y_len = z1 - z0 + over * 2
        ymid = -(z0 + z1) / 2
        top_z = ridge + 0.24
        bm = bmesh.new()
        for side in (-1, 1):
            th = 0.16
            p0 = P(cx, top_z, z1 + over); p1 = P(cx, top_z, z0 - over)
            dx = side * run; dy = -math.tan(pitch) * run
            p2 = p1 + Vector((dx, 0, dy)); p3 = p0 + Vector((dx, 0, dy))
            down = Vector((0, 0, -th))
            vs = [bm.verts.new(v) for v in (p0, p1, p2, p3, p0 + down, p1 + down, p2 + down, p3 + down)]
            for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 3, 7, 4), (1, 5, 6, 2), (3, 2, 6, 7), (0, 4, 5, 1)):
                bm.faces.new([vs[i] for i in f])
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        base = obj_from_bm(name, bm, [M['underlay'] if shingles else mat, M['soffit']], col)
        for p in base.data.polygons:
            p.material_index = 0 if p.normal.z > 0.3 else 1
        # surface detail
        bm = bmesh.new()
        tone = bm.faces.layers.float.new('tone')
        for side in (-1, 1):
            D = Vector((side * math.cos(pitch), 0, -math.sin(pitch)))   # down the slope
            N = Vector((side * math.sin(pitch), 0, math.cos(pitch)))    # out of the roof
            Y = Vector((0, 1, 0))
            R = Vector((cx, ymid, top_z))
            if shingles:
                exp, tab_d, th = 0.143, 0.33, 0.011
                rows = int(slope_len / exp) + 1
                for k in range(rows):
                    s_bot = slope_len - k * exp
                    if s_bot < 0.05: break
                    y = -y_len / 2 + (rng.random() * 0.15 if k % 2 else 0.18)
                    y = -y_len / 2 - (0.17 if k % 2 else 0.0)
                    while y < y_len / 2:
                        w = rng.uniform(0.24, 0.48)
                        y0, y1 = max(y, -y_len / 2), min(y + w, y_len / 2)
                        if y1 - y0 > 0.04:
                            d = min(tab_d, s_bot)
                            c = R + D * (s_bot - d / 2) + N * (th * 0.5 + 0.002 + rng.uniform(0, 0.003)) + Y * ((y0 + y1) / 2 - 0.0025)
                            tilt = Matrix.Rotation(-side * 0.035, 4, 'Y')
                            m = Matrix.Translation(c) @ tilt @ Matrix((D, Y, N)).transposed().to_4x4() @ Matrix.Diagonal((d, y1 - y0 - 0.005, th, 1))
                            res = bmesh.ops.create_cube(bm, size=1.0, matrix=m)
                            tv = rng.random()
                            for f in {f for v in res['verts'] for f in v.link_faces}:
                                f[tone] = tv
                        y += w
            else:
                y = -y_len / 2 + 0.2
                while y < y_len / 2:
                    c = R + D * (slope_len / 2) + N * 0.018 + Y * y
                    m = Matrix.Translation(c) @ Matrix((D, Y, N)).transposed().to_4x4() @ Matrix.Diagonal((slope_len, 0.022, 0.036, 1))
                    bmesh.ops.create_cube(bm, size=1.0, matrix=m)
                    y += 0.45
            # fascia along the eave and rake boards along both gable ends
            eave_c = R + D * slope_len + N * (-0.06)
            bm_box(bm, eave_c - Vector((0, 0, 0.0)), (0.04, y_len + 0.04, 0.24))
            for ys in (-y_len / 2, y_len / 2):
                c = R + D * (slope_len / 2) + N * (-0.04) + Y * ys
                m = Matrix.Translation(c) @ Matrix((D, Y, N)).transposed().to_4x4() @ Matrix.Diagonal((slope_len, 0.04, 0.24, 1))
                bmesh.ops.create_cube(bm, size=1.0, matrix=m)
        det = obj_from_bm(name + '_detail', bm, [M['shingle'] if shingles else mat], col)
        if shingles:
            # fascia/rake boards are the last boxes; colour them by giving them the trim material
            det.data.materials.append(M['trim'])
            for p in det.data.polygons:
                if abs(p.normal.z) < 0.2 and (p.area > 0.04): p.material_index = 1
        # ridge cap
        bm = bmesh.new(); bm_box(bm, P(cx, ridge + 0.3, (z0 + z1) / 2), (0.36, z1 - z0 + over * 2, 0.1))
        obj_from_bm(name + '_cap', bm, M['shingle'] if shingles else mat, col)
    roof(0, RIDGE, 4.5, EAVE, Z0, Z1, 0.7, M['roof'], 'CAB_roof', True)
    roof(-6.25, WRIDGE, 1.75, WEAVE, WZ0, WZ1, 0.45, M['metal'], 'CAB_roof_wing', False)

    # windows, door, trim
    bm_t = bmesh.new(); bm_g = bmesh.new()
    def window(c, w, h, normal_axis):
        t = 0.08
        if normal_axis == 'z':  # wall along x, facing +-z (blender y)
            for dx, dy, sx, sy in ((0, h / 2 + t / 2, w + 2 * t, t), (0, -h / 2 - t * 0.7, w + 2 * t, t * 1.4), (-w / 2 - t / 2, 0, t, h), (w / 2 + t / 2, 0, t, h), (0, 0, 0.04, h), (0, 0, w, 0.04)):
                bm_box(bm_t, c + Vector((dx, 0, dy)), (sx, 0.32, sy))
            bm_box(bm_g, c, (w, 0.008, h))
        else:
            for dz, dy, sx, sy in ((0, h / 2 + t / 2, w + 2 * t, t), (0, -h / 2 - t * 0.7, w + 2 * t, t * 1.4), (-w / 2 - t / 2, 0, t, h), (w / 2 + t / 2, 0, t, h), (0, 0, 0.04, h), (0, 0, w, 0.04)):
                bm_box(bm_t, c + Vector((0, dz, dy)), (0.32, sx, sy))
            bm_box(bm_g, c, (0.008, w, h))
    window(P(-1.75, FLOOR + 1.5, Z1), 1.7, 1.2, 'z')
    window(P(0, 5.6, Z1), 1.2, 1.0, 'z')
    window(P(2.9, FLOOR + 1.5, Z0), 1.0, 1.0, 'z')
    window(P(-6.5, FLOOR + 1.45, WZ1), 1.4, 1.1, 'z')
    window(P(X1, FLOOR + 1.45, 1.7), 1.2, 1.1, 'x')
    window(P(WX0, FLOOR + 1.45, -2.0), 1.1, 1.1, 'x')
    # door frame
    w = DOOR[1] - DOOR[0]
    for c, s in ((P((DOOR[0] + DOOR[1]) / 2, FLOOR + DOOR[2] + 0.05, Z1), (w + 0.2, 0.3, 0.1)), (P(DOOR[0] - 0.05, FLOOR + DOOR[2] / 2, Z1), (0.1, 0.3, DOOR[2])), (P(DOOR[1] + 0.05, FLOOR + DOOR[2] / 2, Z1), (0.1, 0.3, DOOR[2]))):
        bm_box(bm_t, c, s)
    obj_from_bm('CAB_trim', bm_t, M['trim'], col)
    obj_from_bm('CAB_glass', bm_g, M['glass'], col)
    # door leaf on a hinge
    bm = bmesh.new()
    dw = w - 0.02
    for cx, cy, sx, sy in ((dw / 2, 0.07, dw, 0.14), (dw / 2, DOOR[2] - 0.11, dw, 0.22), (dw / 2, 0.59, dw, 0.9), (0.06, DOOR[2] / 2, 0.12, DOOR[2]), (dw - 0.06, DOOR[2] / 2, 0.12, DOOR[2])):
        bm_box(bm, Vector((cx, 0, cy)), (sx, 0.05, sy))
    door = obj_from_bm('CAB_door', bm, M['trim'], col)
    bm = bmesh.new(); bm_box(bm, Vector((dw / 2, 0, 1.14 + (DOOR[2] - 1.25) / 2 + 0.06)), (dw - 0.24, 0.008, DOOR[2] - 1.25))
    dg = obj_from_bm('CAB_door_glass', bm, M['glass'], col); dg.parent = door
    door.location = P(DOOR[0] + 0.01, FLOOR, Z1)
    # sign with carved letters
    bm = bmesh.new(); bm_box(bm, P(-0.15, FLOOR + 2.15, Z1 + 0.16), (0.98, 0.04, 0.32))
    obj_from_bm('CAB_sign', bm, M['trim'], col)
    cu = bpy.data.curves.new('sign_text', 'FONT'); cu.body = 'CAFE PINE'; cu.size = 0.17; cu.extrude = 0.006; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    t = bpy.data.objects.new('CAB_sign_text', cu); col.objects.link(t)
    t.location = P(-0.15, FLOOR + 2.15, Z1 + 0.185); t.rotation_euler = (math.radians(90), 0, 0)
    cu.materials.append(M['sign'])

    # deck
    bm = bmesh.new()
    bm_box(bm, P((X0 + DECK_X) / 2, FLOOR - 0.025, (Z1 + DECK_Z) / 2), (DECK_X - X0, DECK_Z - Z1, 0.05))
    bm_box(bm, P((X1 + DECK_X) / 2, FLOOR - 0.025, (Z1 + RDECK_Z0) / 2), (DECK_X - X1, Z1 - RDECK_Z0, 0.05))
    deck = obj_from_bm('CAB_deck', bm, M['deck'], col)
    bm = bmesh.new()
    bm_box(bm, P((X0 + DECK_X) / 2, FLOOR - 0.15, DECK_Z), (DECK_X - X0, 0.05, 0.24))
    bm_box(bm, P(DECK_X, FLOOR - 0.15, (RDECK_Z0 + DECK_Z) / 2), (0.05, DECK_Z - RDECK_Z0, 0.24))
    def rail(a, b, gaps=()):
        a, b = Vector(a), Vector(b)
        L = (b - a).length; d = (b - a) / L
        segs = [(0, L)]
        for g0, g1 in gaps:
            s = segs.pop(); segs += [(s[0], g0), (g1, s[1])]
        for s0, s1 in segs:
            mid = a + d * ((s0 + s1) / 2)
            along_x = abs(d.x) > 0.5
            sz = lambda l, w, h: (l, w, h) if along_x else (w, l, h)
            bm_box(bm, P(mid.x, FLOOR + 0.98, mid.y), sz(s1 - s0 + 0.06, 0.1, 0.045))
            bm_box(bm, P(mid.x, FLOOR + 0.09, mid.y), sz(s1 - s0, 0.06, 0.05))
            t = s0 + 0.1
            while t < s1 - 0.05:
                p = a + d * t; bm_box(bm, P(p.x, FLOOR + 0.53, p.y), (0.032, 0.032, 0.84)); t += 0.125
            for t in (s0, s1):
                p = a + d * t; bm_box(bm, P(p.x, (FLOOR + 1.02) / 2, p.y), (0.12, 0.12, FLOOR + 1.02))
        t = 2.2
        while t < L - 0.5:
            p = a + d * t; bm_box(bm, P(p.x, FLOOR / 2, p.y), (0.12, 0.12, FLOOR)); t += 2.2
    e = 0.05
    rail((X0 + e, DECK_Z - e), (DECK_X - e, DECK_Z - e), [(STAIR[0] - X0 - .05, STAIR[1] - X0 + .05)])
    rail((DECK_X - e, DECK_Z - e), (DECK_X - e, RDECK_Z0 + e), [(DECK_Z - RSTAIR[1] - .05, DECK_Z - RSTAIR[0] + .05)])
    rail((X0 + e, Z1 + .15), (X0 + e, DECK_Z - e))
    rail((X1 + .15, RDECK_Z0 + e), (DECK_X - e, RDECK_Z0 + e))
    # stairs: stringers and handrails
    def stairs(a0, a1, start, along_z):
        steps, rise, run = 8, FLOOR / 8, 0.27
        for k in range(1, steps):
            c = start + (k - 0.5) * run
            if along_z: bm_t2.append((P((a0 + a1) / 2, FLOOR - k * rise, c), (a1 - a0, 0.3, 0.04)))
            else: bm_t2.append((P(c, FLOOR - k * rise, (a0 + a1) / 2), (0.3, a1 - a0, 0.04)))
        L = math.hypot(steps * run, FLOOR); ang = math.atan2(FLOOR, steps * run)
        for side in (a0 + 0.03, a1 - 0.03):
            mid = start + steps * run / 2
            for yoff, sz in ((-0.12, (L, 0.05, 0.24)), (0.92, (L + 0.1, 0.08, 0.045))):
                if along_z:
                    bm_box(bm, P(side, FLOOR / 2 + yoff, mid), (sz[1], sz[0], sz[2]), Euler((-ang, 0, 0)))
                else:
                    bm_box(bm, P(mid, FLOOR / 2 + yoff, side), sz, Euler((0, ang, 0)))
            pp = P(side, 0.5, start + steps * run - 0.05) if along_z else P(start + steps * run - 0.05, 0.5, side)
            bm_box(bm, pp, (0.1, 0.1, 1.0))
    bm_t2 = []
    stairs(STAIR[0], STAIR[1], DECK_Z, True)
    stairs(RSTAIR[0], RSTAIR[1], DECK_X, False)
    obj_from_bm('CAB_rails', bm, M['black'], col)
    bm = bmesh.new()
    for c, s in bm_t2: bm_box(bm, c, s)
    obj_from_bm('CAB_treads', bm, M['deck'], col)
    # lattice skirt (procedural diamond lattice in the alpha)
    lat = lattice_material()
    bm = bmesh.new()
    for (ax, az, bx, bz) in ((X0, DECK_Z, DECK_X, DECK_Z), (DECK_X, DECK_Z, DECK_X, RDECK_Z0), (X0, Z1, X0, DECK_Z)):
        a = P(ax, 0.02, az); b = P(bx, 0.02, bz)
        up = Vector((0, 0, FLOOR - 0.22))
        bm.faces.new([bm.verts.new(v) for v in (a, b, b + up, a + up)])
    obj_from_bm('CAB_lattice', bm, lat, col)
    bm = bmesh.new(); bm_box(bm, P((X0 + DECK_X) / 2, 0.005, (Z1 + DECK_Z) / 2), (DECK_X - X0, DECK_Z - Z1, 0.01))
    obj_from_bm('CAB_underdeck', bm, flat('under', '#121010', 1.0), col)

    # porch lamps
    lamp_objs = link_asset('industrial_wall_lamp/industrial_wall_lamp_1k.blend', kind='objects')
    base = lamp_objs[0]
    for i, (x, y, z) in enumerate(((2.2, FLOOR + 1.9, Z1 + 0.13), (-3.4, FLOOR + 1.9, Z1 + 0.13))):
        o = base if i == 0 else base.copy()
        col.objects.link(o)
        o.location = P(x, y, z); o.rotation_euler = (0, 0, 0)
    # chimney (stone column)
    bm = bmesh.new(); bm_box(bm, P(5.02, (RIDGE + 0.7) / 2, -2.5), (0.8, 1.6, RIDGE + 0.7))
    obj_from_bm('CAB_chimney', bm, M['stone'], col)
    bm = bmesh.new(); bm_box(bm, P(5.02, RIDGE + 0.76, -2.5), (1.05, 1.85, 0.12))
    obj_from_bm('CAB_chimney_cap', bm, flat('capstone', '#77726A', 0.8), col)
    return door

def lattice_material():
    m = bpy.data.materials.new('lattice'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    b = N['Principled BSDF']; b.inputs['Base Color'].default_value = lin('#2A2826'); b.inputs['Roughness'].default_value = 0.7
    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['Object'], sep.inputs[0])
    def band(sign):
        a = N.new('ShaderNodeMath'); a.operation = 'ADD' if sign > 0 else 'SUBTRACT'
        Lk.new(sep.outputs['X'], a.inputs[0]); Lk.new(sep.outputs['Z'], a.inputs[1])
        a2 = N.new('ShaderNodeMath'); a2.operation = 'ADD'; Lk.new(a.outputs[0], a2.inputs[0]); Lk.new(sep.outputs['Y'], a2.inputs[1])
        s = N.new('ShaderNodeMath'); s.operation = 'PINGPONG'; s.inputs[1].default_value = 0.08
        Lk.new(a2.outputs[0], s.inputs[0])
        g = N.new('ShaderNodeMath'); g.operation = 'LESS_THAN'; g.inputs[1].default_value = 0.022
        Lk.new(s.outputs[0], g.inputs[0])
        return g.outputs[0]
    mx = N.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    Lk.new(band(1), mx.inputs[0]); Lk.new(band(-1), mx.inputs[1])
    Lk.new(mx.outputs[0], b.inputs['Alpha'])
    return m

def cut_openings(o, *hole_lists):
    pass  # openings are covered by window frames, glass and the door; chinking sits behind them

# ---------------------------------------------------------------- interior
IN = dict(x0=-4.37, x1=4.37, z0=-6.88, z1=3.88, wall=3.0)
SLOPE = math.tan(PITCH)
def ceil_at(x): return IN['wall'] + (IN['x1'] - abs(x)) * SLOPE
RIDGE_IN = ceil_at(0)
MUG = (2.05, FLOOR + 0.46, -2.6)

def build_interior(col, M, hidden):
    F = FLOOR
    bm = bmesh.new()
    # floor
    bm.faces.new([bm.verts.new(P(x, F + 0.002, z)) for x, z in ((IN['x0'], IN['z1']), (IN['x1'], IN['z1']), (IN['x1'], IN['z0']), (IN['x0'], IN['z0']))])
    obj_from_bm('IN_floor', bm, M['carpet'], col)
    # walls (thin boxes, openings left as gaps)
    bm = bmesh.new()
    def wall_x(z, holes, top_fn):
        # wall along x at depth z, columns between holes
        xs = sorted({IN['x0'], IN['x1']} | {h[0] for h in holes} | {h[1] for h in holes})
        for i in range(len(xs) - 1):
            a, b = xs[i], xs[i + 1]
            cx = (a + b) / 2
            spans = [(0, top_fn(cx))]
            for h in holes:
                if h[0] <= cx <= h[1]: spans = [(0, h[2]), (h[3], top_fn(cx))]
            for y0, y1 in spans:
                if y1 - y0 > 0.01:
                    bm_box(bm, P(cx, F + (y0 + y1) / 2, z), (b - a, 0.04, y1 - y0))
    def gable_top(x): return ceil_at(x)
    wall_x(IN['z1'], [(DOOR[0], DOOR[1], 0, DOOR[2]), (-2.6, -0.9, 0.9, 2.1)], gable_top)
    wall_x(IN['z0'], [(2.4, 3.4, 1.0, 2.0)], gable_top)
    bm_box(bm, P(IN['x0'], F + 1.5, (IN['z0'] + IN['z1']) / 2), (0.04, IN['z1'] - IN['z0'], 3.0))
    for z0, z1, y0, y1 in ((IN['z0'], 1.1, 0, 3.0), (2.3, IN['z1'], 0, 3.0), (1.1, 2.3, 0, 0.9), (1.1, 2.3, 2.0, 3.0)):
        bm_box(bm, P(IN['x1'], F + (y0 + y1) / 2, (z0 + z1) / 2), (0.04, z1 - z0, y1 - y0))
    walls = obj_from_bm('IN_walls', bm, M['walls'], col)
    # gable triangles above the side-wall line are covered by stepping boxes; add true triangles
    bm = bmesh.new()
    for z in (IN['z1'] - 0.01, IN['z0'] + 0.01):
        pts = [P(IN['x0'], F + 3.0, z), P(IN['x1'], F + 3.0, z), P(0, F + RIDGE_IN, z)]
        if z > 0:
            bm.faces.new([bm.verts.new(p) for p in pts])
        else:
            bm.faces.new([bm.verts.new(p) for p in reversed(pts)])
    obj_from_bm('IN_gables', bm, M['walls'], col)
    # ceiling
    bm = bmesh.new()
    for side in (-1, 1):
        q = [P(side * IN['x1'], F + IN['wall'], IN['z1']), P(side * IN['x1'], F + IN['wall'], IN['z0']), P(0, F + RIDGE_IN, IN['z0']), P(0, F + RIDGE_IN, IN['z1'])]
        if side < 0: q.reverse()
        bm.faces.new([bm.verts.new(p) for p in q])
    obj_from_bm('IN_ceiling', bm, M['ceiling'], col)
    # trusses
    bm = bmesh.new()
    sl = math.hypot(IN['x1'], RIDGE_IN - IN['wall'])
    for z in (-5.4, -1.9, 1.6):
        bm_box(bm, P(0, F + IN['wall'] - 0.13, z), (IN['x1'] * 2, 0.2, 0.26))
        for side in (-1, 1):
            c = P(side * IN['x1'] / 2, F + IN['wall'] + (RIDGE_IN - IN['wall']) / 2 - 0.15, z)
            bm_box(bm, c, (sl + 0.1, 0.2, 0.24), Euler((0, side * PITCH, 0)))
            bm_box(bm, P(side * 1.0, F + IN['wall'] + 0.84, z), (2.45, 0.16, 0.16), Euler((0, -side * 0.75, 0)))
        bm_box(bm, P(0, F + (IN['wall'] + RIDGE_IN) / 2, z), (0.2, 0.2, RIDGE_IN - IN['wall']))
    bm_box(bm, P(0, F + RIDGE_IN - 0.16, (IN['z0'] + IN['z1']) / 2), (0.24, IN['z1'] - IN['z0'], 0.28))
    for side in (-1, 1):
        bm_box(bm, P(side * IN['x1'] * 0.5, F + IN['wall'] + (RIDGE_IN - IN['wall']) * 0.5 - 0.15, (IN['z0'] + IN['z1']) / 2), (0.18, IN['z1'] - IN['z0'], 0.2), Euler((0, side * PITCH, 0)))
    bm_box(bm, P(-0.9, F + (IN['wall'] - 0.26) / 2, -1.9), (0.22, 0.22, IN['wall'] - 0.26))
    obj_from_bm('IN_trusses', bm, M['beam'], col)

    # fireplace
    fx, fz0, fz1 = 3.4, -3.8, -1.2
    op = dict(z0=-3.0, z1=-2.0, y0=0.45, y1=1.25)
    top = ceil_at(fx) - 0.02
    bm = bmesh.new()
    def box3(x0, x1, y0, y1, z0, z1):
        bm_box(bm, P((x0 + x1) / 2, F + (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, z1 - z0, y1 - y0))
    box3(fx, IN['x1'], 0.45, op['y0'], fz0, fz1)
    box3(fx, IN['x1'], op['y0'], op['y1'], fz0, op['z0'])
    box3(fx, IN['x1'], op['y0'], op['y1'], op['z1'], fz1)
    box3(fx, IN['x1'], op['y1'], top, fz0, fz1)
    stone = obj_from_bm('IN_fireplace', bm, M['stone'], col)
    sub = stone.modifiers.new('bevel', 'BEVEL'); sub.width = 0.02; sub.segments = 2
    bm = bmesh.new()
    box3(fx - 0.6, fx + 0.04, 0, 0.45, fz0 - 0.05, fz1 + 0.05)
    obj_from_bm('IN_hearth', bm, M['stone'], col)
    bm = bmesh.new()
    box3(fx + 0.62, fx + 0.66, op['y0'], op['y1'], op['z0'], op['z1'])
    box3(fx + 0.02, fx + 0.66, op['y0'] - 0.02, op['y0'], op['z0'], op['z1'])
    box3(fx + 0.02, fx + 0.66, op['y1'], op['y1'] + 0.02, op['z0'], op['z1'])
    box3(fx + 0.02, fx + 0.66, op['y0'], op['y1'], op['z0'] - 0.02, op['z0'])
    box3(fx + 0.02, fx + 0.66, op['y0'], op['y1'], op['z1'], op['z1'] + 0.02)
    obj_from_bm('IN_firebox', bm, M['soot'], col)
    bm = bmesh.new(); box3(fx - 0.15, fx + 0.12, 1.55, 1.75, fz0 + 0.05, fz1 - 0.05)
    obj_from_bm('IN_mantel', bm, M['beam'], col)
    # fire: charred logs + flame cards
    fc = Vector((fx + 0.32, 0, (op['z0'] + op['z1']) / 2))
    bm = bmesh.new()
    for dx, dy, ry in ((0, 0.06, 0.1), (0.05, 0.06, -0.25), (-0.02, 0.17, 1.2)):
        d = Vector((math.sin(ry), 0, math.cos(ry))) * 0.37
        a = P(fc.x + dx - d.x, F + op['y0'] + dy, fc.z - d.z); b = P(fc.x + dx + d.x, F + op['y0'] + dy, fc.z + d.z)
        bm_cyl(bm, a, b, 0.065, 12, 0.5)
    obj_from_bm('IN_firelogs', bm, M['char'], col, smooth=True)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()
    for i in range(5):
        ang = math.pi / 2 + (i - 2) * 0.42
        w, h = 0.46 - i * 0.03, 0.6 + (i % 2) * 0.12
        c = P(fc.x - 0.02 + i * 0.02, F + op['y0'] + 0.08, fc.z + (i - 2) * 0.06)
        t = Vector((math.cos(ang), math.sin(ang), 0)) * (w / 2)
        vs = [bm.verts.new(c - t), bm.verts.new(c + t), bm.verts.new(c + t + Vector((0, 0, h))), bm.verts.new(c - t + Vector((0, 0, h)))]
        f = bm.faces.new(vs)
        for lp, uv in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))): lp[uvl].uv = uv
    obj_from_bm('IN_flames', bm, M['flame'], col)

    # sofas (Poly Haven leather sofas)
    s3 = link_asset('sofa_03/sofa_03_2k.blend', kind='objects')
    for o in s3:
        col.objects.link(o); o.location = P(0.15, F, -2.45); o.rotation_euler = (0, 0, math.radians(-90))
    s2 = link_asset('sofa_02/sofa_02_2k.blend', kind='objects')
    for o in s2:
        col.objects.link(o)
        if o.parent is None: o.location = P(1.95, F, -0.2); o.rotation_euler = (0, 0, math.radians(180))
    pil = link_asset('throw_pillows_01/throw_pillows_01_1k.blend', kind='objects')
    for i, o in enumerate(pil):
        col.objects.link(o); o.location = P(0.2, F + 0.55, -3.3 + i * 1.6); o.rotation_euler = (0, 0, math.radians(-90 + i * 15))
    ot = link_asset('Ottoman_01/Ottoman_01_1k.blend', kind='objects')
    for o in ot:
        col.objects.link(o); o.location = P(1.15, F, -4.2)
    stb = link_asset('side_table_01/side_table_01_1k.blend', kind='objects')
    for o in stb:
        col.objects.link(o); o.location = P(0.25, F, -0.35)
    # table lamp (brass base + linen shade)
    st_top = F + max((o.dimensions.z for o in stb), default=0.55)
    lamp_base(col, M, P(0.25, st_top, -0.35))
    # rug
    bm = bmesh.new()
    bm.faces.new([bm.verts.new(P(x, F + 0.006, z)) for x, z in ((0.25, -1.15), (3.25, -1.15), (3.25, -3.45), (0.25, -3.45))])
    obj_from_bm('IN_rug', bm, M['rug'], col)
    # live-edge table
    pts = []
    n = 40
    for i in range(n + 1):
        t = i / n; pts.append((t * 1.6 - 0.8, -0.37 + 0.04 * math.sin(t * 9 + 1) + 0.025 * math.sin(t * 23)))
    for i in range(n, -1, -1):
        t = i / n; pts.append((t * 1.6 - 0.8, 0.37 + 0.05 * math.sin(t * 7 + 2) + 0.02 * math.sin(t * 19)))
    bm = bmesh.new()
    tx, tz = 2.0, -2.45
    poly_extrude(bm, pts, F + 0.395, F + 0.46, lambda u, v, h: P(tx + v, h, tz + u))
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co; lp[uvl].uv = (co.y * 0.9, co.x * 0.9 + co.z * 0.3)
    slab = obj_from_bm('IN_table', bm, M['walnut'], col)
    bv = slab.modifiers.new('bevel', 'BEVEL'); bv.width = 0.006; bv.segments = 2
    bm = bmesh.new()
    for dz in (-0.6, 0.6):
        for dx in (-0.25, 0.25):
            bm_box(bm, P(tx + dx, F + 0.2, tz + dz), (0.05, 0.05, 0.4))
        bm_box(bm, P(tx, F + 0.02, tz + dz), (0.55, 0.05, 0.04)); bm_box(bm, P(tx, F + 0.375, tz + dz), (0.55, 0.05, 0.04))
    obj_from_bm('IN_table_legs', bm, M['iron'], col)
    # mug (hero)
    build_mug(col, M, P(*MUG), 'latte')
    # book on the table
    bm = bmesh.new(); bm_box(bm, P(tx - 0.12, F + 0.475, tz + 0.45), (0.22, 0.16, 0.03), Euler((0, 0, 0.3)))
    obj_from_bm('IN_book', bm, flat('book', '#3E4A3A', 0.7), col)

    # pool table
    px, pz = -2.55, -2.6
    W, Lg, H = 1.42, 2.6, 0.8
    bm = bmesh.new()
    bm_box(bm, P(px, F + H - 0.2, pz), (W, Lg, 0.28))
    for sx in (-1, 1):
        for sz in (-1, 1):
            bm_cyl(bm, P(px + sx * (W / 2 - 0.15), F, pz + sz * (Lg / 2 - 0.2)), P(px + sx * (W / 2 - 0.15), F + 0.6, pz + sz * (Lg / 2 - 0.2)), 0.08, 16, 0.5, 0.06)
    for w, d, x, z in ((W, 0.13, 0, Lg / 2 - .065), (W, 0.13, 0, -Lg / 2 + .065), (0.13, Lg, W / 2 - .065, 0), (0.13, Lg, -W / 2 + .065, 0)):
        bm_box(bm, P(px + x, F + H - 0.02, pz + z), (w, d, 0.06))
    pt = obj_from_bm('IN_pooltable', bm, M['beam'], col)
    pt.modifiers.new('bevel', 'BEVEL').width = 0.012
    bm = bmesh.new(); bm_box(bm, P(px, F + H - 0.055, pz), (W - 0.24, Lg - 0.24, 0.02))
    obj_from_bm('IN_felt', bm, M['felt'], col)
    bm = bmesh.new()
    for sx in (-1, 1):
        for sz in (-1, 0, 1):
            bm_cyl(bm, P(px + sx * (W / 2 - 0.12), F + H - 0.06, pz + sz * (Lg / 2 - 0.12)), P(px + sx * (W / 2 - 0.12), F + H - 0.035, pz + sz * (Lg / 2 - 0.12)), 0.06, 16)
    obj_from_bm('IN_pockets', bm, M['soot'], col)
    for i, c in enumerate(('#E9DFC8', '#D8A21E', '#1F3E8C', '#B02420', '#4A2266', '#D2601E', '#1E5A2E', '#701E1E', '#111111')):
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=0.028)
        bmesh.ops.translate(bm, verts=bm.verts, vec=P(px + rng.uniform(-0.45, 0.45), F + H - 0.017, pz + rng.uniform(-0.9, 0.9) + (0.6 if i == 0 else -0.2)))
        obj_from_bm(f'IN_ball{i}', bm, flat(f'ball{i}', c, 0.08, coat=1.0), col, smooth=True)

    # coffee counter
    cz = -6.25
    bm = bmesh.new(); bm_box(bm, P(-0.6, F + 0.5, cz - 0.31), (4.2, 0.62, 1.0))
    obj_from_bm('IN_counter', bm, M['walls'], col)
    bm = bmesh.new(); bm_box(bm, P(-0.6, F + 1.03, cz - 0.3), (4.35, 0.72, 0.06))
    obj_from_bm('IN_countertop', bm, M['walnut'], col)
    bm = bmesh.new()
    bm_box(bm, P(-0.9, F + 1.06 + 0.21, cz - 0.33), (0.72, 0.52, 0.42))
    bm_box(bm, P(-0.9, F + 1.06 + 0.44, cz - 0.33), (0.76, 0.56, 0.04))
    bm_box(bm, P(-0.9, F + 1.1, cz - 0.0), (0.66, 0.18, 0.025))
    for x in (-0.17, 0.17):
        bm_cyl(bm, P(-0.9 + x, F + 1.27, cz - 0.05), P(-0.9 + x, F + 1.33, cz - 0.05), 0.05, 20)
    em = obj_from_bm('IN_espresso', bm, M['steel'], col)
    em.modifiers.new('bevel', 'BEVEL').width = 0.01
    bm = bmesh.new()
    for x in (-0.17, 0.17):
        bm_cyl(bm, P(-0.9 + x, F + 1.26, cz - 0.05), P(-0.9 + x, F + 1.26, cz + 0.12), 0.015, 10)
    bm_box(bm, P(-0.05, F + 1.06 + 0.16, cz - 0.35), (0.18, 0.24, 0.32))
    obj_from_bm('IN_espresso_handles', bm, M['iron'], col)
    bm = bmesh.new(); bm_box(bm, P(-0.6, F + 1.95, IN['z0'] + 0.14), (2.4, 0.28, 0.05))
    obj_from_bm('IN_shelf', bm, M['beam'], col)
    bm = bmesh.new(); bl = bmesh.new()
    for i in range(7):
        bm_box(bm, P(-1.6 + i * 0.32, F + 2.1, IN['z0'] + 0.14), (0.16, 0.1, 0.26))
        bm_box(bl, P(-1.6 + i * 0.32, F + 2.1, IN['z0'] + 0.192), (0.12, 0.004, 0.1))
    obj_from_bm('IN_bags', bm, M['kraft'], col).modifiers.new('bevel', 'BEVEL').width = 0.015
    obj_from_bm('IN_labels', bl, M['label'], col)
    pend = link_asset('hanging_industrial_lamp/hanging_industrial_lamp_1k.blend', kind='objects')[0]
    for i, x in enumerate((-2.0, -0.6, 0.8)):
        o = pend if i == 0 else pend.copy()
        if i: col.objects.link(o)
        else: col.objects.link(o)
        h = o.dimensions.z
        o.location = P(x, F + 2.05 + 0, cz - 0.2)
        o.location.z = F + 2.1
        bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=16, v_segments=10, radius=0.04)
        bmesh.ops.translate(bm, verts=bm.verts, vec=P(x, F + 2.12, cz - 0.2))
        obj_from_bm(f'IN_bulb{i}', bm, M['bulb'], col, smooth=True)
    # counter mugs
    for i, (x, z) in enumerate(((0.55, cz - 0.2), (0.72, cz - 0.28), (0.62, cz - 0.42))):
        build_mug(col, M, P(x, F + 1.06, z), None, name=f'IN_mug{i}')

def lamp_base(col, M, at):
    prof = [(0, 0), (0.09, 0), (0.1, 0.02), (0.05, 0.06), (0.08, 0.18), (0.03, 0.34), (0.015, 0.4), (0, 0.4)]
    bm = lathe(prof, 40)
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    obj_from_bm('IN_lamp_base', bm, M['brass'], col, smooth=True)
    bm = bmesh.new()
    bm_cyl(bm, at + Vector((0, 0, 0.4)), at + Vector((0, 0, 0.68)), 0.24, 40, 0.5, 0.16)
    # remove caps so the shade is open
    for f in [f for f in bm.faces if len(f.verts) > 4]: bm.faces.remove(f)
    sh = obj_from_bm('IN_lamp_shade', bm, M['shade'], col, smooth=True)
    sh.modifiers.new('solid', 'SOLIDIFY').thickness = 0.004

def lathe(prof, seg):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = math.tau * i / seg
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), y)) for r, y in prof])
    for i in range(seg):
        r0, r1 = rings[i], rings[(i + 1) % seg]
        for j in range(len(prof) - 1):
            try: bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
            except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

LIQ = {'coffee': '#2A1A10', 'espresso': '#3B2416', 'milk': '#E9DCC6', 'foam': '#F5EEE2', 'matcha': '#8AA14B', 'chai': '#B9773F'}
RECIPES = {
    'drip': [('coffee', 1)], 'cortado': [('espresso', .5), ('milk', .5)], 'latte': [('espresso', .28), ('milk', .57), ('foam', .15)],
    'capp': [('espresso', .3), ('milk', .3), ('foam', .4)], 'matcha': [('matcha', .48), ('milk', .37), ('foam', .15)], 'chai': [('chai', .78), ('foam', .22)],
}

def build_mug(col, M, at, drink, name='HERO_mug'):
    prof = [(0.0, 0.0), (0.036, 0.0), (0.041, 0.002), (0.043, 0.008), (0.0445, 0.03), (0.0455, 0.07), (0.046, 0.0985), (0.046, 0.104),
            (0.0462, 0.109), (0.0445, 0.1105), (0.0412, 0.1095), (0.0402, 0.104), (0.0399, 0.1), (0.0394, 0.06), (0.0385, 0.02), (0.034, 0.0125), (0.0, 0.012)]
    bm = lathe(prof, 72)
    for f in bm.faces:
        zc = sum(v.co.z for v in f.verts) / len(f.verts)
        rc = sum(math.hypot(v.co.x, v.co.y) for v in f.verts) / len(f.verts)
        f.material_index = 1 if zc > 0.1035 else (2 if rc < 0.0405 and zc > 0.011 else 0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=at)
    mug = obj_from_bm(name, bm, [M['glaze'], M['clay'], M['inner']], col, smooth=True)
    # handle
    hb = bmesh.new()
    bmesh.ops.create_circle(hb, cap_ends=False, radius=0.0065, segments=16)
    path = [(0.044 + 0.025 * math.sin(t), 0.058 + 0.025 * math.cos(t)) for t in [math.pi * i / 24 for i in range(25)]]
    cu = bpy.data.curves.new(name + '_handle', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.0065; cu.bevel_resolution = 4
    sp = cu.splines.new('POLY'); sp.points.add(len(path) - 1)
    for i, (x, z) in enumerate(path): sp.points[i].co = (x, 0, z, 1)
    ho = bpy.data.objects.new(name + '_handle', cu); col.objects.link(ho); ho.location = at
    cu.materials.append(M['glaze']); hb.free()
    if drink:
        y = 0.0125; total = 0.102 - 0.0125
        layers = RECIPES[drink]
        for k, (liq, frac) in enumerate(layers):
            lb = bmesh.new()
            bmesh.ops.create_cone(lb, cap_ends=True, segments=48, radius1=0.0384, radius2=0.0386, depth=frac * total - 0.0004)
            bmesh.ops.translate(lb, verts=lb.verts, vec=at + Vector((0, 0, y + frac * total / 2)))
            obj_from_bm(f'{name}_liq{k}', lb, flat(f'liq_{drink}_{k}', LIQ[liq], 0.3), col, smooth=True)
            y += frac * total
        coffee_top(col, at, y, drink, name)
    return mug

def latte_art(path):
    """Rosetta pattern as a soft white mask on black (1 = white microfoam)."""
    from PIL import Image, ImageDraw, ImageFilter
    S = 1024
    im = Image.new('L', (S, S), 0); d = ImageDraw.Draw(im)
    cx = S * 0.5
    # stacked leaves of the rosetta, widest at the bottom
    for i in range(10):
        t = i / 9
        yc = S * (0.74 - t * 0.5)
        w = S * (0.34 - t * 0.22)
        h = S * (0.085 - t * 0.03)
        d.ellipse([cx - w, yc - h, cx + w, yc + h], fill=235)
        d.ellipse([cx - w * 0.9, yc - h - S * 0.024, cx + w * 0.9, yc + h - S * 0.03], fill=0)
    # heart-shaped head and the pull-through line
    d.ellipse([cx - S * 0.075, S * 0.17, cx + S * 0.075, S * 0.29], fill=240)
    d.line([(cx, S * 0.13), (cx, S * 0.86)], fill=0, width=int(S * 0.012))
    im = im.filter(ImageFilter.GaussianBlur(6))
    # streaks so the art reads as poured milk, not a stencil
    px = im.load()
    rr = random.Random(5)
    for _ in range(2500):
        x, yy = rr.randrange(S), rr.randrange(S)
        if px[x, yy] > 60:
            for k in range(rr.randrange(6, 30)):
                if 0 <= x + k < S: px[x + k, yy] = max(0, px[x + k, yy] - 40)
    im = im.filter(ImageFilter.GaussianBlur(2))
    im.save(path)

def coffee_top(col, at, h, drink, name):
    R = 0.0388
    gen = os.path.join(A, 'generated'); os.makedirs(gen, exist_ok=True)
    art = os.path.join(gen, 'rosetta.png')
    if not os.path.exists(art): latte_art(art)
    # surface disc with a meniscus climbing the wall
    bm = bmesh.new(); uvl = bm.loops.layers.uv.verify()
    rings, segs = 24, 72
    center = bm.verts.new(at + Vector((0, 0, h)))
    grid = []
    for i in range(1, rings + 1):
        r = R * i / rings
        dz = 0.0018 * (i / rings) ** 10
        grid.append([bm.verts.new(at + Vector((r * math.cos(a), r * math.sin(a), h + dz))) for a in (math.tau * j / segs for j in range(segs))])
    for j in range(segs):
        f = bm.faces.new((center, grid[0][j], grid[0][(j + 1) % segs]))
    for i in range(rings - 1):
        for j in range(segs):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][(j + 1) % segs], grid[i][(j + 1) % segs]))
    for f in bm.faces:
        for lp in f.loops:
            v = lp.vert.co - at
            lp[uvl].uv = (v.x / (2 * R) + 0.5, v.y / (2 * R) + 0.5)
    top = obj_from_bm(f'{name}_surface', bm, coffee_material(drink, art), col, smooth=True)
    # bubbles: clustered at the rim, a few drifting on the surface
    bm = bmesh.new()
    rr = random.Random(hash(drink) & 0xffff)
    n = 70 if drink == 'drip' else 170
    for i in range(n):
        if rr.random() < 0.8:
            rad = R * (0.86 + rr.random() * 0.12)
        else:
            rad = R * math.sqrt(rr.random()) * 0.85
        a = rr.random() * math.tau
        size = 0.0003 + rr.random() ** 3 * 0.0011
        zc = h + 0.0018 * (rad / R) ** 10 + size * 0.25
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
        bmesh.ops.translate(bm, verts=res['verts'], vec=at + Vector((rad * math.cos(a), rad * math.sin(a), zc)))
    bub = flat(f'bubble_{drink}', '#F4E8D6' if drink != 'drip' else '#C8A070', 0.02, transmission=0.85)
    bub.node_tree.nodes['Principled BSDF'].inputs['IOR'].default_value = 1.33
    obj_from_bm(f'{name}_bubbles', bm, bub, col, smooth=True)
    # steam: a thin, noisy volume rising off the cup
    bm = bmesh.new(); bm_box(bm, at + Vector((0, 0, h + 0.11)), (0.1, 0.1, 0.2))
    obj_from_bm(f'{name}_steam', bm, steam_material(at, h), col)

def coffee_material(drink, art):
    m = bpy.data.materials.new(f'coffee_top_{drink}'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    b = N['Principled BSDF']
    tc = N.new('ShaderNodeTexCoord')
    if drink == 'drip':
        b.inputs['Base Color'].default_value = lin('#120904'); b.inputs['Roughness'].default_value = 0.03
        b.inputs['Coat Weight'].default_value = 0.6
        return m
    foam = {'latte': '#F3E9DA', 'capp': '#F5EEE2', 'cortado': '#E2CDB0', 'matcha': '#B8C98A', 'chai': '#E8D4B8'}[drink]
    crema = {'latte': '#A86A35', 'capp': '#B8834E', 'cortado': '#9A6232', 'matcha': '#7E9A3E', 'chai': '#B07A45'}[drink]
    # radial distance for the crema ring at the rim
    sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['UV'], sep.inputs[0])
    vx = N.new('ShaderNodeMath'); vx.operation = 'SUBTRACT'; vx.inputs[1].default_value = 0.5; Lk.new(sep.outputs['X'], vx.inputs[0])
    vy = N.new('ShaderNodeMath'); vy.operation = 'SUBTRACT'; vy.inputs[1].default_value = 0.5; Lk.new(sep.outputs['Y'], vy.inputs[0])
    cmb = N.new('ShaderNodeCombineXYZ'); Lk.new(vx.outputs[0], cmb.inputs['X']); Lk.new(vy.outputs[0], cmb.inputs['Y'])
    ln = N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; Lk.new(cmb.outputs[0], ln.inputs[0])
    if drink == 'latte':
        img = N.new('ShaderNodeTexImage'); img.image = bpy.data.images.load(art, check_existing=True); img.image.colorspace_settings.name = 'Non-Color'
        img.extension = 'CLIP'
        Lk.new(tc.outputs['UV'], img.inputs[0])
        mask = img.outputs['Color']
    else:
        # cappuccino/others: a white dome of foam with a thin crema rim
        mr = N.new('ShaderNodeMapRange'); mr.inputs['From Min'].default_value = 0.47; mr.inputs['From Max'].default_value = 0.38
        Lk.new(ln.outputs['Value'], mr.inputs['Value']); mask = mr.outputs['Result']
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 140; nz.inputs['Detail'].default_value = 6
    Lk.new(tc.outputs['Object'], nz.inputs['Vector'])
    cr = N.new('ShaderNodeMix'); cr.data_type = 'RGBA'
    Lk.new(nz.outputs['Fac'], cr.inputs['Factor']); cr.inputs[6].default_value = lin(crema); cr.inputs[7].default_value = lin('#D2A270')
    mx = N.new('ShaderNodeMix'); mx.data_type = 'RGBA'
    Lk.new(mask, mx.inputs['Factor']); Lk.new(cr.outputs[2], mx.inputs[6]); mx.inputs[7].default_value = lin(foam)
    if drink == 'chai':
        sp = N.new('ShaderNodeTexVoronoi'); sp.inputs['Scale'].default_value = 260
        Lk.new(tc.outputs['Object'], sp.inputs['Vector'])
        th = N.new('ShaderNodeMath'); th.operation = 'LESS_THAN'; th.inputs[1].default_value = 0.08
        Lk.new(sp.outputs['Distance'], th.inputs[0])
        cin = N.new('ShaderNodeMix'); cin.data_type = 'RGBA'
        Lk.new(th.outputs[0], cin.inputs['Factor']); Lk.new(mx.outputs[2], cin.inputs[6]); cin.inputs[7].default_value = lin('#6A3A1A')
        Lk.new(cin.outputs[2], b.inputs['Base Color'])
    else:
        Lk.new(mx.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.32
    b.inputs['Subsurface Weight'].default_value = 0.35
    b.inputs['Subsurface Scale'].default_value = 0.002
    b.inputs['Coat Weight'].default_value = 0.15
    # microfoam: tiny dimpled cells plus a few larger open bubbles
    v1 = N.new('ShaderNodeTexVoronoi'); v1.inputs['Scale'].default_value = 2600
    v2 = N.new('ShaderNodeTexVoronoi'); v2.inputs['Scale'].default_value = 700
    Lk.new(tc.outputs['Object'], v1.inputs['Vector']); Lk.new(tc.outputs['Object'], v2.inputs['Vector'])
    pw = N.new('ShaderNodeMath'); pw.operation = 'POWER'; pw.inputs[1].default_value = 0.5
    Lk.new(v2.outputs['Distance'], pw.inputs[0])
    hsum = N.new('ShaderNodeMath'); hsum.operation = 'MULTIPLY_ADD'; hsum.inputs[1].default_value = 0.6
    Lk.new(v1.outputs['Distance'], hsum.inputs[0]); Lk.new(pw.outputs[0], hsum.inputs[2])
    bp = N.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.25; bp.inputs['Distance'].default_value = 0.0004
    Lk.new(hsum.outputs[0], bp.inputs['Height']); Lk.new(bp.outputs['Normal'], b.inputs['Normal'])
    return m

def steam_material(at, h):
    m = bpy.data.materials.new('steam'); m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; Lk = nt.links
    N.remove(N['Principled BSDF'])
    out = N['Material Output']
    vol = N.new('ShaderNodeVolumePrincipled'); vol.inputs['Color'].default_value = (1, 1, 1, 1); vol.inputs['Anisotropy'].default_value = 0.4
    tc = N.new('ShaderNodeTexCoord')
    sep = N.new('ShaderNodeSeparateXYZ'); Lk.new(tc.outputs['Object'], sep.inputs[0])
    # rising, twisting wisps: noise stretched vertically and warped
    mp = N.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (60, 60, 22)
    Lk.new(tc.outputs['Object'], mp.inputs['Vector'])
    nz = N.new('ShaderNodeTexNoise'); nz.inputs['Detail'].default_value = 5; nz.inputs['Distortion'].default_value = 2.5
    Lk.new(mp.outputs[0], nz.inputs['Vector'])
    sh = N.new('ShaderNodeMapRange'); sh.inputs['From Min'].default_value = 0.55; sh.inputs['From Max'].default_value = 0.75
    Lk.new(nz.outputs['Fac'], sh.inputs['Value'])
    # fade with height above the cup and toward the sides
    zf = N.new('ShaderNodeMapRange'); zf.inputs['From Min'].default_value = at.z + h + 0.15; zf.inputs['From Max'].default_value = at.z + h
    Lk.new(sep.outputs['Z'], zf.inputs['Value'])
    xy = N.new('ShaderNodeCombineXYZ'); Lk.new(sep.outputs['X'], xy.inputs['X']); Lk.new(sep.outputs['Y'], xy.inputs['Y'])
    sub = N.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = (at.x, at.y, 0)
    Lk.new(xy.outputs[0], sub.inputs[0])
    ln = N.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'; Lk.new(sub.outputs[0], ln.inputs[0])
    rf = N.new('ShaderNodeMapRange'); rf.inputs['From Min'].default_value = 0.045; rf.inputs['From Max'].default_value = 0.01
    Lk.new(ln.outputs['Value'], rf.inputs['Value'])
    m1 = N.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; Lk.new(sh.outputs['Result'], m1.inputs[0]); Lk.new(zf.outputs['Result'], m1.inputs[1])
    m2 = N.new('ShaderNodeMath'); m2.operation = 'MULTIPLY'; Lk.new(m1.outputs[0], m2.inputs[0]); Lk.new(rf.outputs['Result'], m2.inputs[1])
    m3 = N.new('ShaderNodeMath'); m3.operation = 'MULTIPLY'; m3.inputs[1].default_value = 9.0; Lk.new(m2.outputs[0], m3.inputs[0])
    Lk.new(m3.outputs[0], vol.inputs['Density'])
    Lk.new(vol.outputs[0], out.inputs['Volume'])
    return m

# ---------------------------------------------------------------- lights
def build_lights(col):
    def point(name, loc, watt, kelvin_hex, radius=0.05):
        L = bpy.data.lights.new(name, 'POINT'); L.energy = watt; L.color = lin(kelvin_hex)[:3]; L.shadow_soft_size = radius
        o = bpy.data.objects.new(name, L); o.location = loc; col.objects.link(o); return o
    F = FLOOR
    point('L_fire', P(3.25, F + 0.85, -2.5), 220, '#FF8A3D', 0.25)
    point('L_fire_low', P(3.55, F + 0.55, -2.5), 90, '#FF6A20', 0.2)
    point('L_lamp', P(0.25, F + 1.05, -0.35), 45, '#FFB877', 0.08)
    for i, x in enumerate((-2.0, -0.6, 0.8)):
        point(f'L_pend{i}', P(x, F + 2.08, -6.45), 40, '#FFC27A', 0.04)
    point('L_porch0', P(2.2, F + 1.82, Z1 + 0.3), 0, '#FFB46B', 0.04)
    point('L_porch1', P(-3.4, F + 1.82, Z1 + 0.3), 0, '#FFB46B', 0.04)
    sun = bpy.data.lights.new('L_sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(1.2); sun.color = lin('#FFE2BC')[:3]
    so = bpy.data.objects.new('L_sun', sun); col.objects.link(so)
    d = P(-0.55, 0.5, 0.67).normalized()  # direction toward the sun: front-left, 30 deg up
    so.rotation_euler = (-d).to_track_quat('-Z', 'Y').to_euler()
    # soft fill bouncing off the ceiling, as a room lit by several lamps would have
    A_ = bpy.data.lights.new('L_fill', 'AREA'); A_.energy = 60; A_.size = 3.0; A_.color = lin('#FFC890')[:3]
    o = bpy.data.objects.new('L_fill', A_); o.location = P(0.5, F + 2.6, -2.0); o.rotation_euler = (math.pi, 0, 0); col.objects.link(o)
    o.visible_camera = False; o.visible_glossy = False

# ---------------------------------------------------------------- shots
SHOTS = {
    # name: (camera pos three, target three, focal mm, fstop or None, world, door_open)
    'canopy': ((6, 34, 40), (0, 12, 4), 26, None, 'day', 0),
    'cabin': ((-9.6, 1.75, 16.5), (0.6, 3.3, 1.5), 30, None, 'day', 0),
    'inside': ((-3.0, 3.05, 2.9), (1.0, 2.25, -3.4), 18, None, 'day', 95),
    'brew': ((MUG[0] - 0.27, MUG[1] + 0.33, MUG[2] + 0.1), (MUG[0], MUG[1] + 0.085, MUG[2]), 55, 2.8, 'day', 95),
    'night': ((-10.5, 1.8, 18), (0.5, 3.4, 1.5), 30, None, 'night', 0),
}

def setup_camera():
    cam = bpy.data.cameras.new('CAM'); cam.sensor_width = 36
    o = bpy.data.objects.new('CAM', cam); bpy.context.scene.collection.objects.link(o)
    bpy.context.scene.camera = o
    tgt = bpy.data.objects.new('CAM_target', None); bpy.context.scene.collection.objects.link(tgt)
    tr = o.constraints.new('TRACK_TO'); tr.target = tgt; tr.track_axis = 'TRACK_NEGATIVE_Z'; tr.up_axis = 'UP_Y'
    return o, tgt

def apply_shot(name, cam, tgt, door):
    pos, look, mm, fstop, world, door_open = SHOTS[name]
    cam.location = P(*pos); tgt.location = P(*look)
    cam.data.lens = mm
    cam.data.clip_start = 0.02 if name == 'brew' else 0.05
    cam.data.dof.use_dof = fstop is not None
    if fstop:
        cam.data.dof.focus_distance = (P(*pos) - P(*look)).length
        cam.data.dof.aperture_fstop = fstop
    setup_world(world)
    night = world == 'night'
    bpy.data.objects['L_sun'].data.energy = 0 if night else 3.2
    for n, e in (('L_porch0', 60), ('L_porch1', 60)):
        bpy.data.objects[n].data.energy = e if night else 4
    door.rotation_euler = (0, 0, math.radians(door_open))
    s = bpy.context.scene
    s.view_settings.exposure = {'canopy': 0.0, 'cabin': 0.1, 'inside': 0.7, 'brew': 0.2, 'night': 0.7}[name]
    # hide the interior from exterior day shots far away (saves memory/time) and the forest inside
    bpy.data.collections['SET_interior'].hide_render = name in ('canopy',)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', default='canopy,cabin,inside,brew,night')
    ap.add_argument('--scale', type=int, default=100)
    ap.add_argument('--samples', type=int, default=96)
    ap.add_argument('--save', action='store_true')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--push', action=argparse.BooleanOptionalAction, default=True)
    args = ap.parse_args([a for a in sys.argv[1:] if a.startswith('--') or not a.endswith('.py')])
    t0 = time.time()
    M = build()
    door = bpy.data.objects['CAB_door']
    cam, tgt = setup_camera()
    setup_render(args.scale, args.samples)
    print(f'built in {time.time() - t0:.1f}s', flush=True)
    os.makedirs(OUT, exist_ok=True)
    if args.save:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'scene.blend'))
    for name in args.shots.split(','):
        out = os.path.join(OUT, f'test_{name}.png')
        if os.path.exists(out) and not args.force:
            print(f'skip {name}: already rendered', flush=True); continue
        apply_shot(name, cam, tgt, door)
        tmp = os.path.join(OUT, f'.tmp_{name}.png')
        bpy.context.scene.render.filepath = tmp
        t1 = time.time()
        bpy.ops.render.render(write_still=True)
        os.replace(tmp, out)
        print(f'rendered {name} in {time.time() - t1:.1f}s', flush=True)
        save_and_push(out, args.push)

def save_and_push(png, push):
    """Keep a web copy of every finished frame and push it, so nothing is lost if the run stops."""
    import subprocess
    from PIL import Image
    web = os.path.join(HERE, 'frames_web'); os.makedirs(web, exist_ok=True)
    dst = os.path.join(web, os.path.basename(png).replace('.png', '.webp'))
    Image.open(png).convert('RGB').save(dst, 'WEBP', quality=86, method=6)
    if not push: return
    repo = os.path.dirname(HERE)
    msg = (f'Render {os.path.basename(dst)}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
           'Claude-Session: https://claude.ai/code/session_01DDE6rdUDakZHgTseGkFEqk')
    try:
        subprocess.run(['git', '-C', repo, 'add', dst], check=True, capture_output=True)
        subprocess.run(['git', '-C', repo, 'commit', '-m', msg], check=True, capture_output=True)
        for attempt in range(4):
            r = subprocess.run(['git', '-C', repo, 'push', '-u', 'origin', 'HEAD'], capture_output=True)
            if r.returncode == 0: break
            time.sleep(2 ** (attempt + 1))
        print(f'pushed {os.path.basename(dst)}', flush=True)
    except Exception as e:
        print('push skipped:', e, flush=True)

if __name__ == '__main__':
    main()
