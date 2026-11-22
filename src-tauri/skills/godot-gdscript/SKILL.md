---
name: godot-gdscript
description: Godot 4 via MCP - scenes and nodes (.tscn), GDScript, 3D setup (MeshInstance3D, lights, WorldEnvironment, Camera3D), running the project and reading debug output, glTF import. Use for Godot tasks.
---

# Godot through MCP

Typical tools of Godot MCP servers: launch the editor, run the project, capture debug output, list/create scenes and nodes, edit scripts. Read the Godot version (4.x) and the project structure first.

## Workflow
1. Read `project.godot` and the scene tree before changes. Scenes live in `res://`; keep `scenes/`, `scripts/`, `assets/`.
2. Build a 3D scene: `Node3D` root -> `WorldEnvironment` (sky, tonemap, glow) -> `DirectionalLight3D` (shadow on) -> `Camera3D` -> `MeshInstance3D` with primitive meshes (Box, Sphere, Capsule) and `StandardMaterial3D` (albedo, roughness, metallic) -> collision (`StaticBody3D` + `CollisionShape3D`).
3. Run the project after meaningful steps, read the debug output (errors, warnings), fix, repeat.
4. Units: 1 unit = 1 m, Y is up.

## GDScript
- Typed code: `var speed: float = 4.0`, `@export var speed := 4.0`, `@onready var cam: Camera3D = $Camera3D`. Signals: `signal hit(amount: int)`; connect with `hit.connect(_on_hit)`.
- `_process(delta)` for visuals, `_physics_process(delta)` for movement (`CharacterBody3D.move_and_slide()`); input via `Input.get_vector(...)` and the Input Map.
- Tabs for indentation. Scripts in `res://scripts/`; one script per node role.

## Assets
- Import glTF/GLB (preferred): `.glb` files in `res://assets/` import automatically. Keep triangle counts low for web/mobile exports; use `MultiMeshInstance3D` for many copies.

## Safety
- Do not delete scenes/scripts or edit `project.godot` settings (autoloads, export presets) without asking. Do not run code that touches files outside the project.
