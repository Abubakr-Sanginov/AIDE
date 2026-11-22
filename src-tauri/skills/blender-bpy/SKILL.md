---
name: blender-bpy
description: Blender via MCP and Python (bpy) - modelling, modifiers, materials (Principled BSDF), lights, camera, Cycles/EEVEE render, export to glTF/FBX, scene cleanup and common errors. Use for Blender tasks.
---

# Blender (bpy) through MCP

Typical tools of the Blender MCP servers: get scene info, get object info, get viewport screenshot, execute Python code (`bpy`), plus optional asset/AI-generation integrations. Use the screenshot tool after each step.

## Rules for scripts
- Start by reading state: `bpy.context.scene.objects`, units (`scene.unit_settings`), render engine, active collection.
- Work in object mode: `bpy.ops.object.mode_set(mode='OBJECT')` if the active object is in edit mode. `bpy.ops` needs the right context; prefer the data API (`bpy.data`) and `bmesh` where possible.
- Create into a named collection: `col = bpy.data.collections.new("Scene"); bpy.context.scene.collection.children.link(col)`.
- Each script is short and idempotent: delete only objects you created earlier (by name prefix) before recreating. Never `bpy.ops.object.select_all(action='SELECT')` + delete on a scene you did not create.
- No network, no `os.system`, no file access outside the project folder.

## Modelling
- Primitives: `bpy.ops.mesh.primitive_cube_add(size=1, location=(x,y,z))`, cylinder, uv_sphere, plane, cone, torus. Set `obj.name`, `obj.scale`, then apply scale (`bpy.ops.object.transform_apply(scale=True)`).
- Use modifiers instead of destructive edits: Bevel (width 0.01-0.03, segments 2-3), Subdivision Surface (levels 1-2 for viewport, 2-3 render), Mirror, Array, Solidify, Boolean, Weighted Normal for hard-surface shading.
- Smooth shading: `bpy.ops.object.shade_smooth()` (+ sharp edges by angle). Keep normals consistent.
- Real-world scale: 1 Blender unit = 1 m. A chair seat is about 0.45 m high.

## Materials
```python
mat = bpy.data.materials.new("MAT_Wood"); mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.35, 0.2, 0.1, 1)
bsdf.inputs["Roughness"].default_value = 0.6
obj.data.materials.append(mat)
```
Metals: Metallic 1, Roughness 0.2-0.5. Glass: Transmission 1, Roughness 0-0.1, IOR 1.45. Emission for lamps. Image textures need UVs (`bpy.ops.uv.smart_project()`).

## Light, camera, world
- Area/sun light as key (area 200-1000 W at 3-5 m, sun strength 2-5), softer fill, rim light behind. World background: colour or HDRI, strength 0.3-1.
- Camera: lens 50 mm (portrait 85), aim with a Track To constraint on an Empty at the subject; `scene.camera = cam`.

## Render
- EEVEE for quick checks, Cycles for final (`scene.cycles.samples = 64-128`, denoise on). Resolution `scene.render.resolution_x/y`, `resolution_percentage = 50` for previews.
- Save a render into the project: `scene.render.filepath = "//renders/shot.png"` then `bpy.ops.render.render(write_still=True)`. Then call `studio_show` for the file.

## Export
- glTF: `bpy.ops.export_scene.gltf(filepath=..., export_format='GLB', use_selection=True, export_apply=True)`. FBX: `bpy.ops.export_scene.fbx(filepath=..., use_selection=True, apply_scale_options='FBX_SCALE_ALL', object_types={'MESH','ARMATURE'})`.
- Before export: apply modifiers/transforms, remove unused data, check triangle count, name materials.

## Common errors
- `RuntimeError: Operator bpy.ops... poll() failed, context is incorrect`: wrong mode or no active object; set `bpy.context.view_layer.objects.active = obj` or use the data API.
- Object invisible in render: hidden (`hide_render`), outside camera, no light, or the world is black.
- Pink/missing textures: file path not found; pack images or use project-relative paths.
