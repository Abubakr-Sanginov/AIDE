---
name: unreal-blueprint-cpp
description: Unreal Engine via MCP and Python/console - level setup, actors, static meshes, materials, lights (Lumen), cameras, Blueprints vs C++, import of FBX/glTF, safe changes. Use for Unreal Engine tasks.
---

# Unreal Engine through MCP

Unreal MCP servers usually drive the editor through the Python Editor Script plugin (remote execution) or an in-editor plugin: run Python (`unreal` module), run console commands, spawn/transform/delete actors, import assets, take a viewport screenshot. Check that Python scripting and remote execution are enabled and read the engine version (UE 5.x) first.

## Workflow
1. Read the level: list actors in the current level, the level name and the content folders. Do not assume an empty map.
2. Plan -> blockout with engine basic shapes (`/Engine/BasicShapes/Cube`, `Sphere`, `Cylinder`, `Plane`) -> real meshes -> materials -> lighting -> camera -> check with a viewport screenshot.
3. Put everything you create in a folder (`/Game/AIDE/...`) and an outliner folder (`actor.set_folder_path("AIDE")`), label actors (`set_actor_label`). Save only the assets you created.
4. Units are centimetres: 100 uu = 1 m. Z is up.

## Python snippet (unreal module)
```python
import unreal
mesh = unreal.EditorAssetLibrary.load_asset("/Engine/BasicShapes/Cube.Cube")
actor = unreal.EditorLevelLibrary.spawn_actor_from_object(mesh, unreal.Vector(0, 0, 50))
actor.set_actor_label("Box_01")
actor.set_actor_scale3d(unreal.Vector(1, 1, 0.5))
```
Use `unreal.EditorActorSubsystem` (UE5) where `EditorLevelLibrary` is deprecated. Wrap edits in `unreal.ScopedEditorTransaction("AIDE change")` so the user can undo with Ctrl+Z.

## Materials, light, camera
- Create Material Instances from a parent master material rather than editing the master; set scalar/vector parameters by name.
- Lighting with Lumen (UE5): one Directional Light + Sky Atmosphere + SkyLight + Exponential Height Fog; an unbound Post Process Volume for exposure. Mobility Static only if baking is intended. Avoid many overlapping shadow-casting lights.
- Camera: CineCameraActor, focal length 35-50 mm; or use the viewport screenshot tool for checks.

## Blueprint vs C++
- Gameplay prototyping, level logic and designer-tweakable values -> Blueprint. Performance-critical or heavily reused logic, base classes, data structures -> C++ (`UCLASS`, `UPROPERTY(EditAnywhere, BlueprintReadWrite)`, `UFUNCTION(BlueprintCallable)`), with a Blueprint subclass for tweaking.
- Do not edit C++ or Blueprint assets the user did not ask about. Adding C++ needs a project with a code module and a recompile (Live Coding). When you cannot build a Blueprint graph directly, describe it as a node list and do it in small verifiable pieces.

## Import and budgets
- Import FBX (or glTF with the Interchange pipeline): apply transforms, centimetre scale, one material slot per material, collision generated or authored (`UCX_` meshes). Nanite for high-poly static meshes (UE5), LODs otherwise. Power-of-two textures, up to 2048 for props.
- Report what you measured (actor count, triangles, texture sizes), not guesses.

## Safety
- Do not delete actors, levels or assets you did not create, and do not change Project Settings or packaging settings without asking. Do not run console commands that quit, crash, or change the user's global settings. Python code must not touch files outside the project.
