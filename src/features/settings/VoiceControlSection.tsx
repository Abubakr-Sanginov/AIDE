import { isRuLike } from "@/i18n/ruLike";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { Btn, Row, Section, inputClass } from "@/features/settings/SettingsPanel";
import { Switch } from "@/ui/Switch";
import { applyVoiceControl, useVoiceControl } from "@/features/voice/voiceControl";
import { HOTKEYS, loadVoicePrefs, saveVoicePrefs, type Hotkey, type VoicePrefs } from "@/lib/voiceControl";

const TEXT = {
  en: {
    title: "Voice control of the computer",
    enable: "Control the computer by voice",
    hint:
      "Press the hotkey from any program, say what to do, and the agent in Computer mode does it. Hold the keys while you speak and release to send, or tap once to start and tap again to stop. The command is sent after 3 seconds; press the hotkey again to cancel.",
    hotkey: "Hotkey",
    hotkeyHint: "Works even when AIDE is in the background. A tone tells you when it listens (high) and when it stops (low).",
    active: "Listening for the hotkey",
    whisper: "Needs the Groq key for speech recognition: add it above (Whisper · Groq).",
    consent: "Turn on Computer mode once in the app (the Computer tab) and agree to the terms, then check again.",
    taken: (m: string) => `This hotkey is already used by another program: pick a different one above. (${m})`,
    recheck: "Check again",
    safety:
      "Safety: the agent still asks before every action unless you chose the free permission mode. Do not leave voice control on near people who talk loudly or around audio that may contain commands.",
  },
  ru: {
    title: "Голосовое управление компьютером",
    enable: "Управлять компьютером голосом",
    hint:
      "Нажмите горячую клавишу в любой программе, скажите, что сделать, и агент в режиме «Компьютер» выполнит. Держите клавиши, пока говорите, и отпустите, чтобы отправить, либо нажмите один раз, чтобы начать, и ещё раз, чтобы закончить. Команда уходит через 3 секунды: нажмите клавишу снова, чтобы отменить.",
    hotkey: "Горячая клавиша",
    hotkeyHint: "Работает, даже когда AIDE в фоне. Высокий сигнал: слушаю, низкий: закончил слушать.",
    active: "Слушаю горячую клавишу",
    whisper: "Нужен ключ Groq для распознавания речи: добавьте его выше (Whisper · Groq).",
    consent: "Один раз включите режим «Компьютер» в приложении (вкладка «Компьютер») и согласитесь с условиями, затем проверьте снова.",
    taken: (m: string) => `Эту горячую клавишу уже занимает другая программа: выберите другую выше. (${m})`,
    recheck: "Проверить снова",
    safety:
      "Безопасность: агент по-прежнему спрашивает разрешение на каждое действие, если вы не выбрали режим «Свобода». Не оставляйте голосовое управление включённым рядом с людьми, которые громко говорят, и вокруг звука, где могут быть команды.",
  },
  tg: {
    title: "Идоракунии овозии компютер",
    enable: "Компютерро бо овоз идора кардан",
    hint:
      "Дар ҳар барнома тугмаи гармро пахш кунед, бигӯед чӣ кор кардан лозим, ва агент дар реҷаи «Компютер» иҷро мекунад. То гап мезанед, тугмаҳоро нигоҳ доред ва барои фиристодан раҳо кунед, ё як бор пахш кунед барои оғоз ва боз як бор барои анҷом. Фармон пас аз 3 сония меравад: барои бекор кардан тугмаро боз пахш кунед.",
    hotkey: "Тугмаи гарм",
    hotkeyHint: "Ҳатто вақте ки AIDE дар замина аст, кор мекунад. Садои баланд: гӯш мекунам, паст: гӯш карданро тамом кард.",
    active: "Тугмаи гармро гӯш мекунам",
    whisper: "Барои шинохтани нутқ калиди Groq лозим аст: онро дар боло илова кунед (Whisper · Groq).",
    consent: "Як бор реҷаи «Компютер»-ро дар барнома фаъол кунед (ҷадвали «Компютер») ва розӣ шавед, баъд аз нав санҷед.",
    taken: (m: string) => `Ин тугмаи гармро барномаи дигар ишғол кардааст: дар боло дигарашро интихоб кунед. (${m})`,
    recheck: "Аз нав санҷидан",
    safety:
      "Бехатарӣ: агент ҳамоно пеш аз ҳар амал иҷозат мепурсад, агар реҷаи «Озодӣ»-ро интихоб накарда бошед. Идоракунии овозиро дар назди одамоне, ки баланд гап мезананд, ва дар атрофи садое, ки метавонад фармон дошта бошад, фаъол нагузоред.",
  },
};

export function VoiceControlSection() {
  const { lang } = useI18n();
  const L = lang === "tg" ? TEXT.tg : isRuLike(lang) ? TEXT.ru : TEXT.en;
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs);
  const registered = useVoiceControl((s) => s.registered);
  const problem = useVoiceControl((s) => s.problem);

  useEffect(() => {
    void applyVoiceControl();
  }, []);

  const update = (next: VoicePrefs) => {
    setPrefs(next);
    saveVoicePrefs(next);
    void applyVoiceControl();
  };

  return (
    <Section title={L.title}>
      <Row title={L.enable} hint={L.hint}>
        <div className="flex justify-end">
          <Switch on={prefs.enabled} onChange={() => update({ ...prefs, enabled: !prefs.enabled })} label={L.enable} />
        </div>
      </Row>
      <Row title={L.hotkey} hint={L.hotkeyHint}>
        <select
          aria-label={L.hotkey}
          value={prefs.hotkey}
          onChange={(e) => update({ ...prefs, hotkey: e.target.value as Hotkey })}
          className={inputClass + " font-mono"}
        >
          {HOTKEYS.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </Row>
      {prefs.enabled && (
        <Row
          title={
            registered ? (
              <span className="text-teal-200" role="status">{L.active}: {prefs.hotkey}</span>
            ) : (
              <span className="text-amber-300" role="alert">
                {problem === "whisper" ? L.whisper : problem === "consent" ? L.consent : problem.startsWith("taken:") ? L.taken(problem.slice(6)) : "…"}
              </span>
            )
          }
        >
          {!registered && (
            <div className="flex justify-end">
              <Btn onClick={() => void applyVoiceControl()}>{L.recheck}</Btn>
            </div>
          )}
        </Row>
      )}
      <Row title={<span className="text-[12.5px] font-normal leading-5 text-ink-400">{L.safety}</span>} />
    </Section>
  );
}
