// Local source preview only. No remotely reachable filesystem-writing editor.
process.env.AUTHORING = '1';
await import('tsx/esm');
await import('../server/index.ts');
