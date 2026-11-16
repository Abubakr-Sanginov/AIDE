# Деплой сайта на Vercel

Сайт — статика: HTML на 11 языках, CSS, JS-бандлы, шрифты и установщик в `downloads/`.
Сборка складывает всё нужное в `dist/`, исходники (`src/`, `scripts/`, `package*.json`) в деплой не попадают.

Действующий адрес: **https://aide.victoryapp.online/** (он же прописан в `site.config.json`).

## Что уже готово

- `vercel.json` — команда сборки, выходная папка, заголовки безопасности и редирект
  со старого `aide-site-nine.vercel.app` на основной домен.
- `npm run build:vercel` — `npm run build` (esbuild + генерация 37 страниц, sitemap, robots) и сборка `dist/`.
- `downloads/AIDE-latest-x64-setup.exe` — стабильная ссылка кнопки «Скачать»; сборка сама создаёт её
  из самого свежего `AIDE_<версия>_x64-setup.exe` в папке `downloads/`.

## Вариант 1: из Git

1. Запушьте репозиторий в GitHub (папка `site/` едет вместе с `downloads/`).
2. На vercel.com → **Add New → Project** → выберите репозиторий.
3. **Root Directory** → `site`.
4. Framework Preset → **Other**. Build Command и Output Directory подхватятся из `vercel.json`
   (`npm run build:vercel`, `dist`). Если нет — впишите вручную.
5. **Deploy**.

## Вариант 2: из терминала

```bash
cd site
npx vercel login
npx vercel link --project aide-site
npx vercel deploy --prod --yes
```

## Домен и SEO

- `url` в `site/site.config.json` задаёт canonical, `hreflang`, `sitemap.xml` и `robots.txt`.
  После смены адреса обязательно пересоберите (`npm run build:vercel`) и задеплойте заново.
- Новый домен добавляется в Vercel → Settings → Domains и вписывается в конфиг тем же порядком.
- Старый `*.vercel.app` адрес редиректит на основной домен по правилу `redirects` в `vercel.json`.

## Проверка сборки локально

```bash
cd site
npm ci
npm run build:vercel
```

## Обновление установщика

1. `npm run tauri build` из корня проекта — создаёт `src-tauri/target/release/bundle/nsis/AIDE_<версия>_x64-setup.exe`.
2. Скачайте новый `.exe` из GitHub Releases (там он подписан для автообновления) в `site/downloads/`
   и удалите старый файл.
3. Обновите номер версии рядом с кнопкой (`AIDE v<версия>`) и в футере (`v<версия> · Windows`).
4. `npm run build:vercel` и деплой. Ссылка кнопки не меняется — она ведёт на `AIDE-latest-x64-setup.exe`.
