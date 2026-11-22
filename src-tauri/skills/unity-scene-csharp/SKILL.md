---
name: unity-scene-csharp
description: Unity via MCP - scene and GameObject setup, prefabs, materials (URP/HDRP/Built-in), lighting, cameras, C# scripts (MonoBehaviour), play-mode checks, console errors, build-safe changes. Use for Unity tasks.
---

# Unity through MCP

Typical tools of Unity MCP servers: scene/hierarchy queries, create and modify GameObjects and components, manage assets/prefabs/materials, create and edit C# scripts, read the Console, enter/exit play mode, screenshot of the Scene/Game view. Always check the Unity version and the render pipeline (Built-in, URP, HDRP) first: shaders differ (`Universal Render Pipeline/Lit`, `HDRP/Lit`, `Standard`).

## Workflow
1. Read the hierarchy and the Console before changes. After every change that touches scripts, **wait for compilation and read the Console**: fix errors before doing anything else.
2. Build the scene hierarchically: empty parents (`Environment`, `Props`, `Lighting`, `Gameplay`), children under them. Name objects; reset Transform of new objects; 1 unit = 1 m.
3. Make reusable things prefabs (`Assets/Prefabs/...`); edit the prefab asset, not scene copies.
4. Take a screenshot after the major steps (Scene or Game view), look, fix.
5. Test in Play mode briefly, read the Console, exit Play mode (changes made during Play mode are lost, so do not edit scenes then).

## Scene
- Lights: one Directional Light (intensity about 1, soft shadows), optional Point/Spot; Environment lighting from a Skybox or gradient; baking only when asked. URP: Volume with Tonemapping/Bloom.
- Camera: tag `MainCamera`, field of view 40-60, near clip 0.1. Cinemachine only if the package is already in the project.
- Physics: Rigidbody + Collider on moving objects; static scenery gets static colliders (MeshCollider on simple meshes only, otherwise primitives).

## C# scripts
- File name equals the class name: `public class Mover : MonoBehaviour`. Fields: `[SerializeField] private float speed = 3f;` instead of public fields.
- `Update()` for input and visuals, `FixedUpdate()` for physics, `Awake()` for self-setup, `Start()` for cross-object setup. Cache `GetComponent` results; never call `Find*` every frame. Use `Time.deltaTime`.
- Put scripts in `Assets/Scripts/`. Do not edit files in `Packages/` or `Library/`. No network calls, no file deletion from scripts.
- Use the new Input System only if the project already uses it; otherwise `Input.GetAxis`.

## Assets and performance
- Import models as FBX (or glTF with an importer package) at scale 1; Read/Write only if needed; compress textures (max size 1024-2048). Static batching for scenery, GPU instancing for repeated meshes, LODs for large props. Keep draw calls and triangles within the platform budget.
- Do not delete assets, scenes or packages and do not change project settings (Player, Quality) without asking.

## Common errors
- `NullReferenceException`: an inspector field is not assigned; check `[SerializeField]` references.
- Pink materials: the shader does not match the render pipeline (convert materials to URP/HDRP).
- Script does not attach: class name differs from the file name, or compile errors elsewhere.
