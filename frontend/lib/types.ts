export interface Exam {
  _id: string;
  name: string;
  code: string;
  description: string;
  group: string;
  displayOrder: number;
  marksCorrect: number;
  marksWrong: number;
  minutesPerQuestion: number;
}

export interface Paper {
  year: number | null;
  /** e.g. "December" — exams can run more than once a year. */
  session: string;
  /** URL-safe id, e.g. "2024-december". */
  slug: string;
  /** Display label, e.g. "December 2024". */
  label: string;
  questionCount: number;
  durationMinutes: number;
}

export interface Topic {
  _id: string;
  examId: string;
  name: string;
  displayOrder: number;
}

export type OptionKey = "A" | "B" | "C" | "D";

export interface QuestionOption {
  key: OptionKey;
  text: string;
}

export interface MatchListItem {
  label: string;
  text: string;
}

/** "Match List I with List II" — both lists, row-aligned as printed. */
export interface MatchList {
  leftTitle: string;
  rightTitle: string;
  left: MatchListItem[];
  right: MatchListItem[];
}

export interface Question {
  _id: string;
  examId: string;
  topicId: string | null;
  year: number | null;
  questionNumber?: number | null;
  /** Markdown (tables, $math$, figures). */
  questionText: string;
  matchList?: MatchList | null;
  stemAfter?: string;
  options: QuestionOption[];
  correctOption: OptionKey;
  explanation: string;
  sourceCitation: string;
}

export type AttemptMode = "practice" | "exam";
export type AttemptStatus = "in_progress" | "submitted" | "auto_submitted";

/** In exam mode these omit correctOption/explanation until the attempt is submitted. */
export interface AttemptQuestion {
  id: string;
  questionNumber?: number | null;
  questionText: string;
  matchList?: MatchList | null;
  stemAfter?: string;
  options: QuestionOption[];
  year: number | null;
  topicId: string | null;
  correctOption?: OptionKey;
  explanation?: string;
  sourceCitation?: string;
}

export interface AttemptAnswer {
  questionId: string;
  selectedOption: OptionKey | null;
  isCorrect?: boolean;
}

export interface AttemptView {
  id: string;
  mode: AttemptMode;
  status: AttemptStatus;
  year: number | null;
  session: string;
  paperLabel: string;
  startedAt: string;
  durationMinutes: number | null;
  submittedAt: string | null;
  score: number | null;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  marksCorrect: number;
  marksWrong: number;
  exam: { id: string; name: string; code: string; group: string } | null;
  answers: AttemptAnswer[];
  questions: AttemptQuestion[];
}

export interface AttemptHistoryItem {
  _id: string;
  mode: AttemptMode;
  status: AttemptStatus;
  year: number | null;
  session: string;
  startedAt: string;
  submittedAt: string | null;
  score: number | null;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  questionIds: string[];
  examId: { _id: string; name: string; code: string; group: string } | null;
}

/** GET /attempts/in-progress — is there an unfinished attempt at this paper? */
export interface InProgressInfo {
  exists: boolean;
  attemptId?: string;
  answeredCount?: number;
  totalQuestions?: number;
  startedAt?: string;
  durationMinutes?: number | null;
}

/** Response from PATCH /attempts/:id/answer — practice mode returns the answer. */
export interface AnswerResponse {
  ok: true;
  correctOption?: OptionKey;
  explanation?: string;
  isCorrect?: boolean;
}
