import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev
export default defineConfig({
    plugins: [react()],
    base: '/oddsen_tracker_v2/', // <-- LEGG TIL DENNE LINJEN
});
