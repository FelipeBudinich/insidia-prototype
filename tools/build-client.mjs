import { build } from 'vite';
import { createBakeConfig } from './bake/vite.config.mjs';
await build(createBakeConfig({ gameName: 'insidia', emptyOutDir: true }));
