import { build } from 'esbuild';
await build({ entryPoints: ['src/main.jsx'], bundle: true, outfile: 'dist/app.js', format: 'esm', minify: true, external: ['three','three/addons/*'], define: {'process.env.NODE_ENV':'"production"'}, legalComments:'linked' });
