# Cafe Pine: Blender renders

Photoreal renders of the Cafe Pine forest, cabin and great room, made with Blender 5.3 (the `bpy` module) and Cycles.

- `fetch.py` downloads the Poly Haven assets into `assets/`: pine and fir trees, grass, ferns, shrubs, leather sofas, lamps, scanned textures and two sky images. They're CC0 and kept out of git.
- `build_scene.py` builds the whole scene from an empty file: terrain, scattered forest and lawn, the log cabin with its deck, and the interior with the fireplace, sofas, live-edge table, pool table and coffee counter. It then renders the test shots into `renders/`.

```sh
pip install bpy==5.3.0
python3 fetch.py
python3 build_scene.py --shots canopy,cabin,inside,brew,night --samples 96
```

Use `--scale 25 --samples 8` for a quick draft. A full-quality 1280×720 frame takes about 6 minutes on a 4-core CPU.
