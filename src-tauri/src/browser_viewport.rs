//! Размер «экрана» во встроенном браузере: телефон, планшет, компьютер или свой.
//!
//! Страница живёт в дочернем webview, который AIDE кладёт в область панели. Чтобы показать сайт так, как
//! его увидит человек с экраном другого размера, webview получает нужную ширину и высоту в CSS-пикселях.
//! Если такой размер не помещается в панель (например 1440 px на панели в 700), webview уменьшается и
//! масштабируется (zoom): страница по-прежнему считает, что окно 1440 px, а на панели видна её уменьшенная копия.
//! Так media-запросы и вёрстка ведут себя ровно как на настоящем устройстве.

use serde_json::Value;

pub const MIN_SIDE: u32 = 200;
pub const MAX_WIDTH: u32 = 3840;
pub const MAX_HEIGHT: u32 = 2400;
/// Меньший масштаб уже ничего не покажет: страница станет нечитаемой.
const MIN_SCALE: f64 = 0.1;

/// Готовые размеры (CSS-пиксели): телефон, планшет, компьютер.
pub const DEVICES: [(&str, u32, u32); 3] = [("mobile", 390, 844), ("tablet", 820, 1180), ("desktop", 1440, 900)];

/// `None` — «по размеру панели».
pub type Viewport = Option<(u32, u32)>;

/// Размер по имени: `fit` — вся панель, остальное — из `DEVICES`.
pub fn preset(name: &str) -> Option<Viewport> {
    let name = name.trim().to_lowercase();
    if name == "fit" {
        return Some(None);
    }
    DEVICES.iter().find(|(n, _, _)| *n == name).map(|&(_, w, h)| Some((w, h)))
}

/// Проверка своего размера: границы защищают от нулей и от гигантских значений.
pub fn clamp(width: u32, height: u32) -> Result<(u32, u32), String> {
    if !(MIN_SIDE..=MAX_WIDTH).contains(&width) || !(MIN_SIDE..=MAX_HEIGHT).contains(&height) {
        return Err(format!("Размер окна: ширина {MIN_SIDE}–{MAX_WIDTH}, высота {MIN_SIDE}–{MAX_HEIGHT} пикселей"));
    }
    Ok((width, height))
}

/// Где и с каким масштабом разместить webview внутри области панели.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Layout {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub zoom: f64,
}

/// `pane` — область панели (x, y, ширина, высота) в логических пикселях окна.
pub fn layout(pane: (f64, f64, f64, f64), viewport: Viewport) -> Layout {
    let (px, py, pw, ph) = pane;
    let Some((vw, vh)) = viewport else {
        return Layout { x: px, y: py, w: pw, h: ph, zoom: 1.0 };
    };
    let (vw, vh) = (vw as f64, vh as f64);
    let scale = (pw / vw).min(ph / vh).min(1.0).max(MIN_SCALE);
    let (w, h) = (vw * scale, vh * scale);
    Layout { x: px + ((pw - w) / 2.0).max(0.0), y: py + ((ph - h) / 2.0).max(0.0), w, h, zoom: scale }
}

/// Проверка вёрстки на текущем размере: выполняется в странице, возвращает короткий JSON-текст (данные, а не команды).
pub const AUDIT_JS: &str = r#"(function(){
var iw=innerWidth,ih=innerHeight,de=document.documentElement;
var out={w:iw,h:ih,scrollW:de.scrollWidth,meta:!!document.querySelector('meta[name=viewport]')};
function name(el){var s=el.tagName.toLowerCase();if(el.id)s+='#'+String(el.id).slice(0,20);else if(typeof el.className==='string'&&el.className.trim())s+='.'+el.className.trim().split(/\s+/)[0].slice(0,20);return s}
function scrolls(el){for(var p=el.parentElement,n=0;p&&n<12;p=p.parentElement,n++){var o=getComputedStyle(p).overflowX;if(o==='auto'||o==='scroll'||o==='hidden'||o==='clip')return true}return false}
var wide=[],small=[],tiny=[],nw=0,ns=0,nt=0;
var els=document.body?document.body.querySelectorAll('*'):[];
for(var i=0;i<els.length&&i<4000;i++){
 var el=els[i],r=el.getBoundingClientRect();
 if(r.width<1||r.height<1)continue;
 var cs=getComputedStyle(el);
 if(cs.display==='none'||cs.visibility==='hidden')continue;
 if(r.right>iw+1&&cs.position!=='fixed'&&!scrolls(el)){nw++;if(wide.length<5)wide.push(name(el)+' '+Math.round(r.width)+'px, правый край '+Math.round(r.right))}
 if(/^(A|BUTTON|INPUT|SELECT|TEXTAREA)$/.test(el.tagName)||el.getAttribute('role')==='button'){
  if(Math.min(r.width,r.height)<32&&r.left<iw){ns++;if(small.length<5)small.push(name(el)+' '+Math.round(r.width)+'x'+Math.round(r.height))}}
 var fs=parseFloat(cs.fontSize);
 if(fs&&fs<12){var own='';for(var c=el.firstChild;c;c=c.nextSibling)if(c.nodeType===3)own+=c.nodeValue;
  if(own.trim().length>2){nt++;if(tiny.length<3)tiny.push(name(el)+' '+fs+'px')}}
}
out.wide=wide;out.nWide=nw;out.small=small;out.nSmall=ns;out.tiny=tiny;out.nTiny=nt;
return JSON.stringify(out).slice(0,3500)})()"#;

/// Превращает ответ `AUDIT_JS` в строки отчёта по одному размеру экрана.
pub fn report(device: &str, raw: &str) -> String {
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return format!("{device}: не удалось проверить страницу ({})", raw.chars().take(120).collect::<String>());
    };
    let n = |k: &str| v[k].as_u64().unwrap_or(0);
    let (w, h, scroll_w) = (n("w"), n("h"), n("scrollW"));
    let phone_like = w < 1024;
    let list = |k: &str| v[k].as_array().map(|a| a.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("; ")).unwrap_or_default();
    let mut issues: Vec<String> = Vec::new();
    if scroll_w > w + 1 {
        issues.push(format!("горизонтальная прокрутка: ширина содержимого {scroll_w}px при окне {w}px"));
    }
    if n("nWide") > 0 {
        issues.push(format!("за правым краем {} эл.: {}", n("nWide"), list("wide")));
    }
    if phone_like && !v["meta"].as_bool().unwrap_or(true) {
        issues.push("нет <meta name=\"viewport\"> (на телефоне страница откроется в масштабе рабочего стола)".into());
    }
    if phone_like && n("nSmall") > 0 {
        issues.push(format!("мелкие цели нажатия (<32px) {} шт.: {}", n("nSmall"), list("small")));
    }
    if n("nTiny") > 0 {
        issues.push(format!("мелкий текст (<12px) {} эл.: {}", n("nTiny"), list("tiny")));
    }
    if issues.is_empty() {
        format!("{device} {w}x{h}: замечаний нет")
    } else {
        format!("{device} {w}x{h}:\n  - {}", issues.join("\n  - "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_and_custom_sizes() {
        assert_eq!(preset("mobile"), Some(Some((390, 844))));
        assert_eq!(preset(" Desktop "), Some(Some((1440, 900))));
        assert_eq!(preset("fit"), Some(None));
        assert_eq!(preset("watch"), None);
        assert!(clamp(390, 844).is_ok());
        for (w, h) in [(0, 800), (199, 800), (800, 199), (3841, 800), (800, 2401), (u32::MAX, u32::MAX)] {
            assert!(clamp(w, h).is_err(), "{w}x{h}");
        }
    }

    #[test]
    fn fit_keeps_the_pane_and_no_zoom() {
        let l = layout((10.0, 20.0, 700.0, 500.0), None);
        assert_eq!(l, Layout { x: 10.0, y: 20.0, w: 700.0, h: 500.0, zoom: 1.0 });
    }

    #[test]
    fn a_small_screen_is_centered_without_zoom() {
        let l = layout((0.0, 0.0, 800.0, 1000.0), Some((390, 844)));
        assert_eq!((l.w, l.h, l.zoom), (390.0, 844.0, 1.0));
        assert_eq!((l.x, l.y), (205.0, 78.0));
    }

    #[test]
    fn a_large_screen_is_scaled_down_to_fit() {
        // 1440x900 в панели 720x600: масштаб по ширине 0.5
        let l = layout((100.0, 50.0, 720.0, 600.0), Some((1440, 900)));
        assert!((l.zoom - 0.5).abs() < 1e-9);
        assert_eq!((l.w, l.h), (720.0, 450.0));
        assert_eq!((l.x, l.y), (100.0, 125.0));
        // внутри панели, при этом CSS-размер страницы остаётся 1440x900
        assert!(l.w / l.zoom == 1440.0 && l.h / l.zoom == 900.0);
        // очень маленькая панель: масштаб не падает ниже предела, размеры не отрицательные
        let tiny = layout((0.0, 0.0, 50.0, 50.0), Some((3840, 2400)));
        assert!(tiny.zoom >= MIN_SCALE && tiny.x >= 0.0 && tiny.y >= 0.0);
    }

    #[test]
    fn report_lists_layout_problems() {
        let raw = r#"{"w":390,"h":844,"scrollW":520,"meta":false,"wide":["div.hero 520px, правый край 520"],"nWide":1,"small":["button.x 20x20"],"nSmall":2,"tiny":["span.note 10px"],"nTiny":1}"#;
        let r = report("mobile", raw);
        for needle in ["mobile 390x844", "горизонтальная прокрутка", "div.hero", "нет <meta", "мелкие цели нажатия", "мелкий текст"] {
            assert!(r.contains(needle), "{needle}: {r}");
        }
        let ok = report("desktop", r#"{"w":1440,"h":900,"scrollW":1440,"meta":false,"wide":[],"nWide":0,"small":[],"nSmall":9,"tiny":[],"nTiny":0}"#);
        // на компьютере отсутствие meta viewport и мелкие кнопки не считаются проблемой
        assert_eq!(ok, "desktop 1440x900: замечаний нет");
        assert!(report("x", "not json").contains("не удалось"));
    }
}
