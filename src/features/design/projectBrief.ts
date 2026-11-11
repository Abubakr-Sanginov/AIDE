// The task text that "Create in project" sends to the project agent. It is written in the language
// chosen in the app: the user sees it in the chat as their own message, and the agent answers in
// the same language. Covers the app's ten languages and Tajik; anything else falls back to English.

export interface Brief {
  intro: (folder: string) => string;
  stack: (name: string, code: string, css: string) => string;
  codeTs: string;
  codeJs: string;
  cssPlain: string;
  cssTailwind: string;
  folders: string;
  screens: string;
  needs: string;
  reproduce: string;
  navYes: string;
  navNo: string;
  respYes: string;
  respNo: string;
  rules: string;
  ruleFolder: (folder: string) => string;
  rulePin: string;
  ruleGit: string;
  ruleSecrets: string;
  runYes: string;
  runNo: string;
  finish: string;
  reply: string;
  devices: { desktop: string; tablet: string; mobile: string };
}

const en: Brief = {
  intro: (f) => `Create a project in the \`${f}/\` folder from the finished design.`,
  stack: (n, c, s) => `Stack: ${n}${c ? `, ${c}` : ""}. Styles: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "plain CSS (stylesheets or CSS modules), no CSS frameworks",
  cssTailwind: "Tailwind CSS (current stable version, set up the way the framework's docs recommend)",
  folders: "Structure",
  screens: "Design screens (finished HTML, read each file with read_file):",
  needs: "Requirements:",
  reproduce: "- Reproduce the design as closely as possible: structure, colors, fonts, spacing, states. Extract repeated parts into components.",
  navYes: "- Add navigation between the screens (routing) so every link and menu button works.",
  navNo: "- Every button and link must work.",
  respYes: "- Make the layout responsive (desktop, tablet, phone).",
  respNo: "- Responsiveness is optional.",
  rules: "Rules:",
  ruleFolder: (f) => `- Create and edit files only inside \`${f}/\`. Do not change \`${f}/design/\`: it holds the design sources.`,
  rulePin: "- Pin dependency versions exactly (no ^ and no latest). Never invent package names: verify each with `npm view <package> version`.",
  ruleGit: "- Add a .gitignore (node_modules, dist, .env) and a README.md with run commands.",
  ruleSecrets: "- Never put secrets or keys in code. Do not load scripts from a CDN.",
  runYes: "- When the files are ready, propose running `npm install` and `npm run dev` in that folder (I will approve) and check that the project builds.",
  runNo: "- Do not install dependencies or start anything: tell me the commands to do it.",
  finish: "- Finish with a short description of the project structure.",
  reply: "Reply in English; write the README and explanations in English too.",
  devices: { desktop: "desktop", tablet: "tablet", mobile: "phone" },
};

const ru: Brief = {
  intro: (f) => `Создай в папке \`${f}/\` проект по готовому дизайну.`,
  stack: (n, c, s) => `Стек: ${n}${c ? `, язык ${c}` : ""}. Стили: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "обычный CSS (файлы стилей или CSS-модули), без CSS-фреймворков",
  cssTailwind: "Tailwind CSS (актуальная стабильная версия; подключи так, как рекомендует документация выбранного фреймворка)",
  folders: "Структура",
  screens: "Экраны дизайна (готовый HTML, прочитай каждый файл через read_file):",
  needs: "Что нужно:",
  reproduce: "- Перенеси дизайн максимально точно: структуру, цвета, шрифты, отступы, состояния. Повторяющееся вынеси в компоненты.",
  navYes: "- Сделай навигацию между экранами (роутинг), чтобы все ссылки и кнопки меню работали.",
  navNo: "- Все кнопки и ссылки должны работать.",
  respYes: "- Сделай адаптивную вёрстку (десктоп, планшет, телефон).",
  respNo: "- Адаптивность не обязательна.",
  rules: "Правила:",
  ruleFolder: (f) => `- Создавай и меняй файлы только внутри \`${f}/\`. Папку \`${f}/design/\` не меняй: это исходники дизайна.`,
  rulePin: "- Версии зависимостей закрепи точными номерами (без ^ и latest). Названия пакетов не выдумывай: проверь каждый через `npm view <пакет> version`.",
  ruleGit: "- Добавь .gitignore (node_modules, dist, .env) и README.md с командами запуска.",
  ruleSecrets: "- Секреты и ключи в код не пиши. Внешние скрипты с CDN не подключай.",
  runYes: "- Когда файлы готовы, предложи выполнить `npm install` и `npm run dev` в этой папке (я подтвержу) и проверь, что проект собирается.",
  runNo: "- Установку зависимостей и запуск не выполняй: скажи, какими командами это сделать.",
  finish: "- В конце коротко опиши структуру проекта.",
  reply: "Отвечай по-русски; README и пояснения тоже пиши по-русски.",
  devices: { desktop: "компьютер", tablet: "планшет", mobile: "телефон" },
};

const de: Brief = {
  intro: (f) => `Erstelle im Ordner \`${f}/\` ein Projekt nach dem fertigen Design.`,
  stack: (n, c, s) => `Stack: ${n}${c ? `, ${c}` : ""}. Styles: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "reines CSS (Stylesheets oder CSS-Module), keine CSS-Frameworks",
  cssTailwind: "Tailwind CSS (aktuelle stabile Version, so eingerichtet, wie es die Doku des Frameworks empfiehlt)",
  folders: "Struktur",
  screens: "Design-Screens (fertiges HTML, lies jede Datei mit read_file):",
  needs: "Anforderungen:",
  reproduce: "- Setze das Design so genau wie möglich um: Struktur, Farben, Schriften, Abstände, Zustände. Wiederkehrende Teile gehören in Komponenten.",
  navYes: "- Baue die Navigation zwischen den Screens (Routing), damit alle Links und Menüpunkte funktionieren.",
  navNo: "- Alle Buttons und Links müssen funktionieren.",
  respYes: "- Mach das Layout responsiv (Desktop, Tablet, Smartphone).",
  respNo: "- Responsivität ist optional.",
  rules: "Regeln:",
  ruleFolder: (f) => `- Erstelle und ändere Dateien nur in \`${f}/\`. Ändere \`${f}/design/\` nicht: Dort liegen die Design-Quellen.`,
  rulePin: "- Pinne Abhängigkeiten auf exakte Versionen (kein ^, kein latest). Erfinde keine Paketnamen: Prüfe jedes Paket mit `npm view <Paket> version`.",
  ruleGit: "- Lege eine .gitignore (node_modules, dist, .env) und eine README.md mit den Startbefehlen an.",
  ruleSecrets: "- Schreibe keine Geheimnisse oder Schlüssel in den Code. Binde keine Skripte von einem CDN ein.",
  runYes: "- Wenn die Dateien fertig sind, schlage vor, `npm install` und `npm run dev` in diesem Ordner auszuführen (ich bestätige) und prüfe, ob das Projekt baut.",
  runNo: "- Installiere keine Abhängigkeiten und starte nichts: Nenne mir die Befehle dafür.",
  finish: "- Beschreibe am Ende kurz die Projektstruktur.",
  reply: "Antworte auf Deutsch; schreibe README und Erklärungen ebenfalls auf Deutsch.",
  devices: { desktop: "Desktop", tablet: "Tablet", mobile: "Smartphone" },
};

const fr: Brief = {
  intro: (f) => `Crée dans le dossier \`${f}/\` un projet à partir du design terminé.`,
  stack: (n, c, s) => `Stack : ${n}${c ? `, ${c}` : ""}. Styles : ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "CSS simple (feuilles de style ou modules CSS), sans framework CSS",
  cssTailwind: "Tailwind CSS (version stable actuelle, installé comme le recommande la documentation du framework)",
  folders: "Structure",
  screens: "Écrans du design (HTML terminé, lis chaque fichier avec read_file) :",
  needs: "Exigences :",
  reproduce: "- Reproduis le design le plus fidèlement possible : structure, couleurs, polices, espacements, états. Extrais les parties répétées en composants.",
  navYes: "- Ajoute la navigation entre les écrans (routage) pour que tous les liens et boutons de menu fonctionnent.",
  navNo: "- Chaque bouton et chaque lien doit fonctionner.",
  respYes: "- Rends la mise en page responsive (ordinateur, tablette, téléphone).",
  respNo: "- Le responsive est facultatif.",
  rules: "Règles :",
  ruleFolder: (f) => `- Crée et modifie des fichiers uniquement dans \`${f}/\`. Ne modifie pas \`${f}/design/\` : ce sont les sources du design.`,
  rulePin: "- Fixe les versions des dépendances exactement (pas de ^, pas de latest). N'invente pas de noms de paquets : vérifie chacun avec `npm view <paquet> version`.",
  ruleGit: "- Ajoute un .gitignore (node_modules, dist, .env) et un README.md avec les commandes de lancement.",
  ruleSecrets: "- N'écris aucun secret ni clé dans le code. Ne charge aucun script depuis un CDN.",
  runYes: "- Quand les fichiers sont prêts, propose d'exécuter `npm install` et `npm run dev` dans ce dossier (je validerai) et vérifie que le projet se construit.",
  runNo: "- N'installe pas les dépendances et ne lance rien : indique-moi les commandes.",
  finish: "- Termine par une courte description de la structure du projet.",
  reply: "Réponds en français ; rédige aussi le README et les explications en français.",
  devices: { desktop: "ordinateur", tablet: "tablette", mobile: "téléphone" },
};

const es: Brief = {
  intro: (f) => `Crea en la carpeta \`${f}/\` un proyecto a partir del diseño terminado.`,
  stack: (n, c, s) => `Stack: ${n}${c ? `, ${c}` : ""}. Estilos: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "CSS simple (hojas de estilo o módulos CSS), sin frameworks CSS",
  cssTailwind: "Tailwind CSS (versión estable actual, configurado como recomienda la documentación del framework)",
  folders: "Estructura",
  screens: "Pantallas del diseño (HTML terminado, lee cada archivo con read_file):",
  needs: "Requisitos:",
  reproduce: "- Reproduce el diseño con la mayor fidelidad posible: estructura, colores, fuentes, espaciados, estados. Extrae lo repetido a componentes.",
  navYes: "- Añade la navegación entre pantallas (enrutado) para que todos los enlaces y botones del menú funcionen.",
  navNo: "- Todos los botones y enlaces deben funcionar.",
  respYes: "- Haz el diseño adaptable (escritorio, tableta y móvil).",
  respNo: "- Que sea adaptable es opcional.",
  rules: "Reglas:",
  ruleFolder: (f) => `- Crea y modifica archivos solo dentro de \`${f}/\`. No cambies \`${f}/design/\`: contiene las fuentes del diseño.`,
  rulePin: "- Fija las versiones de las dependencias con números exactos (sin ^ ni latest). No inventes nombres de paquetes: comprueba cada uno con `npm view <paquete> version`.",
  ruleGit: "- Añade un .gitignore (node_modules, dist, .env) y un README.md con los comandos de arranque.",
  ruleSecrets: "- No escribas secretos ni claves en el código. No cargues scripts desde un CDN.",
  runYes: "- Cuando los archivos estén listos, propón ejecutar `npm install` y `npm run dev` en esa carpeta (yo confirmaré) y comprueba que el proyecto compila.",
  runNo: "- No instales dependencias ni inicies nada: dime los comandos para hacerlo.",
  finish: "- Al final describe brevemente la estructura del proyecto.",
  reply: "Responde en español; escribe también el README y las explicaciones en español.",
  devices: { desktop: "escritorio", tablet: "tableta", mobile: "móvil" },
};

const pt: Brief = {
  intro: (f) => `Crie na pasta \`${f}/\` um projeto a partir do design finalizado.`,
  stack: (n, c, s) => `Stack: ${n}${c ? `, ${c}` : ""}. Estilos: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "CSS puro (folhas de estilo ou módulos CSS), sem frameworks de CSS",
  cssTailwind: "Tailwind CSS (versão estável atual, configurado como a documentação do framework recomenda)",
  folders: "Estrutura",
  screens: "Telas do design (HTML pronto, leia cada arquivo com read_file):",
  needs: "Requisitos:",
  reproduce: "- Reproduza o design com a maior fidelidade possível: estrutura, cores, fontes, espaçamentos, estados. Extraia o que se repete para componentes.",
  navYes: "- Adicione a navegação entre as telas (roteamento) para que todos os links e botões do menu funcionem.",
  navNo: "- Todos os botões e links devem funcionar.",
  respYes: "- Deixe o layout responsivo (desktop, tablet e celular).",
  respNo: "- Responsividade é opcional.",
  rules: "Regras:",
  ruleFolder: (f) => `- Crie e altere arquivos somente dentro de \`${f}/\`. Não altere \`${f}/design/\`: ali ficam as fontes do design.`,
  rulePin: "- Fixe as versões das dependências com números exatos (sem ^ e sem latest). Não invente nomes de pacotes: verifique cada um com `npm view <pacote> version`.",
  ruleGit: "- Adicione um .gitignore (node_modules, dist, .env) e um README.md com os comandos para rodar.",
  ruleSecrets: "- Não escreva segredos nem chaves no código. Não carregue scripts de uma CDN.",
  runYes: "- Quando os arquivos estiverem prontos, sugira executar `npm install` e `npm run dev` nessa pasta (eu aprovarei) e verifique se o projeto compila.",
  runNo: "- Não instale dependências nem inicie nada: diga os comandos para isso.",
  finish: "- No fim, descreva brevemente a estrutura do projeto.",
  reply: "Responda em português; escreva também o README e as explicações em português.",
  devices: { desktop: "desktop", tablet: "tablet", mobile: "celular" },
};

const it: Brief = {
  intro: (f) => `Crea nella cartella \`${f}/\` un progetto a partire dal design finito.`,
  stack: (n, c, s) => `Stack: ${n}${c ? `, ${c}` : ""}. Stili: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "CSS semplice (fogli di stile o moduli CSS), senza framework CSS",
  cssTailwind: "Tailwind CSS (versione stabile attuale, configurato come consiglia la documentazione del framework)",
  folders: "Struttura",
  screens: "Schermate del design (HTML finito, leggi ogni file con read_file):",
  needs: "Requisiti:",
  reproduce: "- Riproduci il design il più fedelmente possibile: struttura, colori, font, spaziature, stati. Estrai le parti ripetute in componenti.",
  navYes: "- Aggiungi la navigazione tra le schermate (routing) in modo che tutti i link e i pulsanti del menu funzionino.",
  navNo: "- Ogni pulsante e ogni link deve funzionare.",
  respYes: "- Rendi il layout responsive (desktop, tablet e telefono).",
  respNo: "- Il responsive è facoltativo.",
  rules: "Regole:",
  ruleFolder: (f) => `- Crea e modifica file solo dentro \`${f}/\`. Non modificare \`${f}/design/\`: contiene i sorgenti del design.`,
  rulePin: "- Fissa le versioni delle dipendenze con numeri esatti (niente ^ e niente latest). Non inventare nomi di pacchetti: verifica ciascuno con `npm view <pacchetto> version`.",
  ruleGit: "- Aggiungi un .gitignore (node_modules, dist, .env) e un README.md con i comandi di avvio.",
  ruleSecrets: "- Non scrivere segreti o chiavi nel codice. Non caricare script da una CDN.",
  runYes: "- Quando i file sono pronti, proponi di eseguire `npm install` e `npm run dev` in quella cartella (confermerò io) e controlla che il progetto compili.",
  runNo: "- Non installare dipendenze e non avviare nulla: indicami i comandi per farlo.",
  finish: "- Alla fine descrivi brevemente la struttura del progetto.",
  reply: "Rispondi in italiano; scrivi anche il README e le spiegazioni in italiano.",
  devices: { desktop: "desktop", tablet: "tablet", mobile: "telefono" },
};

const zh: Brief = {
  intro: (f) => `请在 \`${f}/\` 文件夹中，根据已完成的设计创建项目。`,
  stack: (n, c, s) => `技术栈：${n}${c ? `，${c}` : ""}。样式：${s}。`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "原生 CSS（样式表或 CSS 模块），不使用 CSS 框架",
  cssTailwind: "Tailwind CSS（当前稳定版本，按所选框架文档推荐的方式配置）",
  folders: "目录结构",
  screens: "设计页面（已完成的 HTML，请用 read_file 读取每个文件）：",
  needs: "要求：",
  reproduce: "- 尽可能精确地还原设计：结构、颜色、字体、间距、状态。把重复的部分提取为组件。",
  navYes: "- 实现页面之间的导航（路由），确保所有链接和菜单按钮都能用。",
  navNo: "- 所有按钮和链接都必须可用。",
  respYes: "- 做成响应式布局（桌面、平板、手机）。",
  respNo: "- 响应式不是必须的。",
  rules: "规则：",
  ruleFolder: (f) => `- 只在 \`${f}/\` 内创建和修改文件。不要改动 \`${f}/design/\`：那里是设计源文件。`,
  rulePin: "- 依赖版本必须固定为确切版本号（不要用 ^，不要用 latest）。不要凭空编造包名：用 `npm view <包名> version` 逐个确认。",
  ruleGit: "- 添加 .gitignore（node_modules、dist、.env）和包含运行命令的 README.md。",
  ruleSecrets: "- 不要把密钥或机密写进代码，不要从 CDN 加载脚本。",
  runYes: "- 文件创建完成后，建议在该文件夹运行 `npm install` 和 `npm run dev`（由我确认），并检查项目能否构建。",
  runNo: "- 不要安装依赖，也不要启动任何程序：只告诉我该用哪些命令。",
  finish: "- 最后简要说明项目结构。",
  reply: "请用中文回复；README 和说明也用中文撰写。",
  devices: { desktop: "桌面", tablet: "平板", mobile: "手机" },
};

const ja: Brief = {
  intro: (f) => `完成したデザインをもとに、\`${f}/\` フォルダーにプロジェクトを作成してください。`,
  stack: (n, c, s) => `スタック: ${n}${c ? `、${c}` : ""}。スタイル: ${s}。`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "素の CSS（スタイルシートまたは CSS モジュール）、CSS フレームワークなし",
  cssTailwind: "Tailwind CSS（現在の安定版。選んだフレームワークのドキュメントが推奨する方法で導入）",
  folders: "構成",
  screens: "デザインの画面（完成した HTML。各ファイルを read_file で読み込んでください）:",
  needs: "要件:",
  reproduce: "- デザインをできるだけ忠実に再現してください: 構造、色、フォント、余白、状態。繰り返し出てくる部分はコンポーネントにしてください。",
  navYes: "- 画面間のナビゲーション（ルーティング）を実装し、すべてのリンクとメニューボタンが動くようにしてください。",
  navNo: "- すべてのボタンとリンクが動作するようにしてください。",
  respYes: "- レスポンシブなレイアウトにしてください（デスクトップ、タブレット、スマートフォン）。",
  respNo: "- レスポンシブ対応は任意です。",
  rules: "ルール:",
  ruleFolder: (f) => `- ファイルの作成・変更は \`${f}/\` の中だけで行ってください。\`${f}/design/\` はデザインの元データなので変更しないでください。`,
  rulePin: "- 依存パッケージのバージョンは正確な番号で固定してください（^ や latest は使わない）。パッケージ名を創作せず、`npm view <パッケージ> version` で一つずつ確認してください。",
  ruleGit: "- .gitignore（node_modules、dist、.env）と、起動コマンドを書いた README.md を追加してください。",
  ruleSecrets: "- シークレットやキーをコードに書かないでください。CDN からスクリプトを読み込まないでください。",
  runYes: "- ファイルが揃ったら、そのフォルダーで `npm install` と `npm run dev` を実行することを提案し（私が承認します）、プロジェクトがビルドできることを確認してください。",
  runNo: "- 依存パッケージのインストールや起動は行わず、そのためのコマンドを教えてください。",
  finish: "- 最後に、プロジェクト構成を簡潔に説明してください。",
  reply: "返信は日本語でお願いします。README や説明も日本語で書いてください。",
  devices: { desktop: "デスクトップ", tablet: "タブレット", mobile: "スマートフォン" },
};

const ko: Brief = {
  intro: (f) => `완성된 디자인을 바탕으로 \`${f}/\` 폴더에 프로젝트를 만들어 주세요.`,
  stack: (n, c, s) => `스택: ${n}${c ? `, ${c}` : ""}. 스타일: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "순수 CSS(스타일시트 또는 CSS 모듈), CSS 프레임워크 없음",
  cssTailwind: "Tailwind CSS(현재 안정 버전, 선택한 프레임워크 문서가 권장하는 방식으로 설정)",
  folders: "구조",
  screens: "디자인 화면(완성된 HTML, 각 파일을 read_file로 읽으세요):",
  needs: "요구 사항:",
  reproduce: "- 디자인을 최대한 정확하게 재현하세요: 구조, 색상, 글꼴, 여백, 상태. 반복되는 부분은 컴포넌트로 분리하세요.",
  navYes: "- 화면 간 이동(라우팅)을 만들어 모든 링크와 메뉴 버튼이 동작하게 하세요.",
  navNo: "- 모든 버튼과 링크가 동작해야 합니다.",
  respYes: "- 반응형 레이아웃으로 만드세요(데스크톱, 태블릿, 휴대폰).",
  respNo: "- 반응형은 선택 사항입니다.",
  rules: "규칙:",
  ruleFolder: (f) => `- 파일은 \`${f}/\` 안에서만 만들고 수정하세요. \`${f}/design/\`은 디자인 원본이므로 바꾸지 마세요.`,
  rulePin: "- 의존성 버전은 정확한 번호로 고정하세요(^나 latest 사용 금지). 패키지 이름을 지어내지 말고 `npm view <패키지> version`으로 하나씩 확인하세요.",
  ruleGit: "- .gitignore(node_modules, dist, .env)와 실행 명령이 담긴 README.md를 추가하세요.",
  ruleSecrets: "- 비밀 값이나 키를 코드에 쓰지 마세요. CDN에서 스크립트를 불러오지 마세요.",
  runYes: "- 파일이 준비되면 그 폴더에서 `npm install`과 `npm run dev` 실행을 제안하고(제가 승인합니다) 프로젝트가 빌드되는지 확인하세요.",
  runNo: "- 의존성 설치나 실행은 하지 말고, 그 방법(명령어)만 알려 주세요.",
  finish: "- 마지막에 프로젝트 구조를 간단히 설명하세요.",
  reply: "답변은 한국어로 해 주세요. README와 설명도 한국어로 작성하세요.",
  devices: { desktop: "데스크톱", tablet: "태블릿", mobile: "휴대폰" },
};

const tg: Brief = {
  intro: (f) => `Дар ҷузвдони \`${f}/\` аз рӯи тарҳи тайёр лоиҳа эҷод кунед.`,
  stack: (n, c, s) => `Стек: ${n}${c ? `, ${c}` : ""}. Услубҳо: ${s}.`,
  codeTs: "TypeScript",
  codeJs: "JavaScript",
  cssPlain: "CSS-и оддӣ (варақаҳои услуб ё модулҳои CSS), бе фреймворкҳои CSS",
  cssTailwind: "Tailwind CSS (нусхаи устувори ҳозира, мувофиқи тавсияи ҳуҷҷатҳои фреймворк танзим карда мешавад)",
  folders: "Сохтор",
  screens: "Экранҳои тарҳ (HTML-и тайёр, ҳар файлро тавассути read_file хонед):",
  needs: "Талабот:",
  reproduce: "- Тарҳро ба қадри имкон дақиқ такрор кунед: сохтор, рангҳо, ҳарфҳо, фосилаҳо, ҳолатҳо. Қисмҳои такроршавандаро ба компонентҳо ҷудо кунед.",
  navYes: "- Байни экранҳо навигатсия (роутинг) созед, то ҳамаи истинодҳо ва тугмаҳои меню кор кунанд.",
  navNo: "- Ҳамаи тугмаҳо ва истинодҳо бояд кор кунанд.",
  respYes: "- Тарҳро мутобиқшаванда созед (компютер, планшет ва телефон).",
  respNo: "- Мутобиқшавӣ ихтиёрӣ аст.",
  rules: "Қоидаҳо:",
  ruleFolder: (f) => `- Файлҳоро танҳо дар дохили \`${f}/\` эҷод ва тағйир диҳед. \`${f}/design/\`-ро тағйир надиҳед: он манбаъҳои тарҳ аст.`,
  rulePin: "- Версияҳои вобастагиҳоро бо рақами дақиқ муқаррар кунед (бе ^ ва бе latest). Номи бастаҳоро аз худ наандешед: ҳар якро бо `npm view <баста> version` санҷед.",
  ruleGit: "- .gitignore (node_modules, dist, .env) ва README.md бо фармонҳои оғоз илова кунед.",
  ruleSecrets: "- Рамзҳо ва калидҳоро ба код нанависед. Скриптҳоро аз CDN бор накунед.",
  runYes: "- Вақте ки файлҳо тайёранд, иҷрои `npm install` ва `npm run dev`-ро дар ин ҷузвдон пешниҳод кунед (ман тасдиқ мекунам) ва санҷед, ки лоиҳа месозад.",
  runNo: "- Вобастагиҳоро насб накунед ва чизеро оғоз накунед: фармонҳои лозимиро ба ман бигӯед.",
  finish: "- Дар охир сохтори лоиҳаро кӯтоҳ тавсиф кунед.",
  reply: "Бо забони тоҷикӣ ҷавоб диҳед; README ва шарҳҳоро низ бо тоҷикӣ нависед.",
  devices: { desktop: "компютер", tablet: "планшет", mobile: "телефон" },
};

const BRIEFS: Record<string, Brief> = { en, ru, de, fr, es, pt, it, zh, ja, ko, tg };

export function briefFor(lang: string): Brief {
  return BRIEFS[lang] ?? en;
}
