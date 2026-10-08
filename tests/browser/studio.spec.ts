import { test, expect } from '@playwright/test';
test('create, inspect, save, export both modules and reopen comparison',async({page,request})=>{
  await page.goto('/');await expect(page.getByText('TWO LEGENDS.')).toBeVisible();
  await expect(page.locator('.demo-strip')).toContainText('Invented values');
  await page.getByRole('button',{name:'Inspect Goals',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('Exact ratio: 90 / 1');await page.getByRole('button',{name:'Close dialog'}).click();
  await page.getByRole('button',{name:'Build comparison'}).click();await expect(page.getByRole('status')).toContainText('saved');
  for(const module of ['Career overview','Goal efficiency','International performance']){
    await page.getByRole('button',{name:new RegExp(module)}).click();await page.getByRole('button',{name:'Export PNG',exact:true}).click();await expect(page.getByRole('link',{name:'Download PNG'})).toBeVisible({timeout:30000});
    const link=await page.getByRole('link',{name:'Download PNG'}).getAttribute('href');const image=await request.get(link!);expect(image.ok()).toBeTruthy();const bytes=await image.body();expect(bytes.readUInt32BE(16)).toBe(1080);expect(bytes.readUInt32BE(20)).toBe(1920);
    const metadataLink=await page.getByRole('link',{name:'Source metadata'}).getAttribute('href');const metadata=await (await request.get(metadataLink!)).json();const exportTab=await page.context().newPage();await exportTab.goto(`/?export=${metadata.dashboard.id}&page=${metadata.page}`);await exportTab.locator('[data-export-ready]').waitFor();await exportTab.evaluate(()=>document.fonts.ready);expect(await exportTab.locator('.poster-exclusions').evaluate(el=>el.getBoundingClientRect().bottom<=1920)).toBeTruthy();await exportTab.close();
  }
  await page.getByRole('button',{name:'My comparisons'}).click();await expect(page.getByRole('dialog')).toContainText('Ronaldo vs Messi');await page.getByRole('button',{name:'Close dialog'}).click();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'runtime/studio-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'runtime/studio-mobile.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});
test('write requests reject cross-origin submissions',async({request})=>{const res=await request.post('/api/comparisons',{data:{snapshotId:'DEMO_2025_26_V1'},headers:{Origin:'https://external.invalid'}});expect(res.status()).toBe(403);});
