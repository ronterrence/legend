import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'tests/browser',workers:1,use:{baseURL:'http://127.0.0.1:4318',headless:true},webServer:{command:'npm run dev',url:'http://127.0.0.1:4318/api/health',env:{PORT:'4318',LEGEND_DATA_DIR:'runtime/e2e'},reuseExistingServer:false},reporter:'list'});
