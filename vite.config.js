import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    proxy: {
      '/trcloud-api': {
        target: 'https://thaidrill.trcloud.co',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/trcloud-api/, ''),
        headers: {
          'Cookie': '_ga=GA1.2.983562244.1778134911; _gid=GA1.2.564485271.1778134911; trcloud=8e571048f440ec1245431da9a6916a01; PHPSESSID=etp1dmaskcg8ulrq5adhmehu00',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'X-Requested-With': 'XMLHttpRequest',
          'Origin': 'https://thaidrill.trcloud.co',
          'Referer': 'https://thaidrill.trcloud.co/application/'
        }
      }
    }
  }
})