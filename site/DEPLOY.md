# Деплой сайта на Vercel

Сайт — статика: HTML на 11 языках, CSS, JS-бандлы, шрифты и установщик в `downloads/`.
Сборка складывает всё нужное в `dist/`, исходники (`src/`, `scripts/`, `package*.json`) в деплой не попадают.

## Что уже готово

- `vercel.json` — команда сборки, выходная папка, заголовки безопасности.
- `npm run build:vercel` — `npm run build` (esbuild + генерация 33 страниц) и сборка `dist/`.
- `downloads/AIDE_<версия>_x64-setup.exe` — файл для кнопки «Скачать».

## Вариант 1: из Git (рекомендуется)

1. Запушьте репозиторий в GitHub/GitLab (папка `site/` должна ехать вместе с `downloads/`).
2. На vercel.com → **Add New → Project** → выберите репозиторий.
3. **Root Directory** → `site`.
4. Framework Preset → **Other**. Build Command и Output Directory подхватятся из `vercel.json`
   (`npm run build:vercel`, `dist`). Если нет — впишите вручную.
5. **Deploy**. Через ~1 минуту сайт будет на `https://<project>.vercel.app`.

## Вариант 2: из терминала

```bash
cd site
npx vercel login
npx vercel --prod
```

## После первого деплоя

- Впишите настоящий адрес в `site/site.config.json`:
  ```json
  { "url": "https://<project>.vercel.app/" }
  ```
  Это включает canonical-ссылки, `sitemap.xml` и `robots.txt` — пересоберите (`npm run build:vercel`) и задеплойте заново.
- Свой домен: Vercel → Settings → Domains, потом обновите `url` в конфиге.

## Проверка сборки локально

```bash
cd site
npm ci
npm run build:vercel
npx serve dist        # или любой статический сервер
```

## Обновление установщика

```bash
npm run tauri build   # из корня проекта, создаёт src-tauri/target/release/bundle/nsis/AIDE_<версия>_x64-setup.exe
```

Скопируйте новый `.exe` в `site/downloads/`, обновите имя файла в ссылке (`site/index.html`, кнопка `.start__btn`)
и версию (`AIDE v0.2.2` рядом с кнопкой и `v0.2.2 · Windows` в футере), затем пересоберите сайт.
