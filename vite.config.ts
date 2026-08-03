import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 빌드 출력은 web/ — Electron 내부 서버와 Go 서버(embed)가 그대로 서빙한다.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'web',
    emptyOutDir: true
  }
});
