import { build } from 'esbuild';
await build({entryPoints:['shared/protocol/schema.ts'],outfile:'public/games/insidia/network/protocol.js',bundle:true,format:'esm',platform:'browser',minify:true});
