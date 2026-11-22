import { useEffect, useRef, useState } from "react";
import { isLocalResourceUrl } from "@/lib/studioPreview";

/** base64 → bytes. */
function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * A small three.js viewer for .glb / .gltf. three.js is loaded only when a model is opened.
 * The file is untrusted: no address is ever fetched (only data:/blob: resources), and nothing runs from it.
 */
export function ModelViewer({ name, mime, data }: { name: string; mime: string; data: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    setError("");
    setLoading(true);
    void (async () => {
      try {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        if (disposed) return;

        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        el.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
        scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.4));
        const sun = new THREE.DirectionalLight(0xffffff, 2.2);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        const resize = () => {
          const w = Math.max(el.clientWidth, 1);
          const h = Math.max(el.clientHeight, 1);
          renderer.setSize(w, h);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(el);

        const manager = new THREE.LoadingManager();
        // A glTF may point at external files or addresses: refuse everything except embedded data.
        manager.setURLModifier((url) => (isLocalResourceUrl(url) ? url : ""));
        const loader = new GLTFLoader(manager);
        const buffer: ArrayBuffer | string = mime === "model/gltf+json" ? new TextDecoder().decode(fromBase64(data)) : fromBase64(data);
        loader.parse(
          buffer,
          "",
          (gltf) => {
            if (disposed) return;
            scene.add(gltf.scene);
            const box = new THREE.Box3().setFromObject(gltf.scene);
            const size = box.getSize(new THREE.Vector3());
            const center = box.getCenter(new THREE.Vector3());
            const radius = Math.max(size.x, size.y, size.z, 0.001);
            camera.position.copy(center).add(new THREE.Vector3(radius * 1.2, radius * 0.8, radius * 1.6));
            camera.near = radius / 100;
            camera.far = radius * 100;
            camera.updateProjectionMatrix();
            controls.target.copy(center);
            controls.update();
            setLoading(false);
          },
          (e) => {
            if (disposed) return;
            setLoading(false);
            setError(e instanceof Error ? e.message : "Не удалось прочитать модель");
          },
        );

        let raf = 0;
        const tick = () => {
          raf = requestAnimationFrame(tick);
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          controls.dispose();
          scene.traverse((o) => {
            const m = o as import("three").Mesh;
            m.geometry?.dispose?.();
            const mat = m.material;
            for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) x.dispose();
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
        if (disposed) cleanup();
      } catch (e) {
        if (!disposed) {
          setLoading(false);
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    })();
    return () => {
      disposed = true;
      cleanup();
    };
  }, [data, mime]);

  return (
    <div className="relative h-full w-full" aria-label={name}>
      <div ref={host} className="h-full w-full" />
      {loading && !error && <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-ink-400">…</div>}
      {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-[12.5px] text-red-400">{error}</div>}
    </div>
  );
}
