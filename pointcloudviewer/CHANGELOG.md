# Street Viewer Navigation Updates

- Converted COLMAP extrinsics from camera-to-world to world-to-camera on load and normalised intrinsics in `hooks/useSceneData.ts`. Navigation edges are now built with `NAV_GRAPH_RADIUS` and `NAV_GRAPH_NEIGHBORS` (default 5 m / 6 links) so lateral shots remain connected.
- The Street Viewer now classifies neighbours in camera space, projects them with the calibrated matrices, and places one stable arrow per side once the image is ready. Toggle verbose diagnostics with `NAV_DEBUG` to inspect neighbour counts and the selected targets.

> Tune arrows by adjusting `NAV_GRAPH_RADIUS` / `NAV_GRAPH_NEIGHBORS` in `useSceneData.ts`; increase to widen search, decrease to limit long hops.
