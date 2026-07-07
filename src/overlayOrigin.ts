/**
 * Overlay origin in global screen coordinates, passed by the Rust side via the
 * `ox`/`oy` URL params. On single-monitor setups both are 0; on multi-monitor
 * setups secondary displays may have negative or large positive offsets.
 *
 * Add this offset to window-relative clientX/clientY to get global screen coords;
 * subtract it from global (e.g. CGWindowList) bounds to get canvas coords.
 */
export function overlayOrigin(): { x: number; y: number } {
  const params = new URLSearchParams(window.location.search);
  return {
    x: parseInt(params.get("ox") ?? "0", 10),
    y: parseInt(params.get("oy") ?? "0", 10),
  };
}
