// Formatting of the user's answers to the agent's clarifying questions.
// The string is sent back to the model as the tool result of `ask_user`,
// so it is kept plain-text, bounded and human-readable.
export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionInput {
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiple?: boolean;
  allow_custom?: boolean;
}

export interface QuestionSelection {
  options: string[];
  custom: string;
}

const MAX_ANSWER_CHARS = 8000;

export function formatAnswers(
  questions: QuestionInput[],
  selections: Record<number, QuestionSelection>,
): string {
  const lines: string[] = ["Ответы пользователя на уточняющие вопросы:"];
  questions.forEach((q, i) => {
    const sel = selections[i] ?? { options: [], custom: "" };
    const parts = [...sel.options];
    const custom = sel.custom.trim();
    if (custom) parts.push(custom);
    lines.push(`${i + 1}. ${q.question.trim()}`);
    lines.push(`   Ответ: ${parts.length > 0 ? parts.join(", ") : "(не выбрано)"}`);
  });
  const out = lines.join("\n");
  return out.length > MAX_ANSWER_CHARS ? out.slice(0, MAX_ANSWER_CHARS) : out;
}

export function isQuestionAnswered(sel: QuestionSelection | undefined): boolean {
  if (!sel) return false;
  return sel.options.length > 0 || sel.custom.trim().length > 0;
}
