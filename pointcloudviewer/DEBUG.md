# development problems encountered

## Not connected to internet
If raw.githack.com .hdr file doesn't load (downloaded from the internet), the point cloud or GLBViewer itself won't load.

## Ports in use
Summary: Don't fight forge, let it serve the renderer (main app) on port 3000 and listen on (webpack dev server- more for logging) 9000. Do not unify them, they are not meant to be unified.

## Content Security Policy Updates
Right now, https://raw.githack.com is needed to load some .hdr background file (presumably @react-three/drei) and the Content-Security-Policy blocks that and crashes the app. Force CSP update in index.ts (temporary solution), electron doesn't listen to webpack renderer config or forge config at runtime to update CSP, use this commmand to print CSP in DevTools console: 
```javascript
(async () => {
  const r = await fetch(location.href, { cache: 'no-store' });
  console.log('[CSP][HEADER]', r.headers.get('content-security-policy'));
})();
```

Now we can start the server and load something.

## Node.js module dependecies

Summary: Node.js is not recommended to use in renderer, only in preload scripts. Module @vercel/webpack-asset-relocator-loader uses __dirname so we move it from webpack.rules.ts (renderer and preload inherits from) to preload script only. 
Additionally, require() is not available so we change webpack.renderer.config.ts target from 'electron-renderer' to 'web'.

# Keyboard controls GLB Viewer
forward: W or ArrowUp
backward: S or ArrowDown
left: A or ArrowLeft
right: D or ArrowRight
up: Space
down: either Shift key (ShiftLeft, ShiftRight)

# Ray Cast miss
Threshold based on nearby points.
Threshold = 0.05 seems to work for sceneCOLMAP.